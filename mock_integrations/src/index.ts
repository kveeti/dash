import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { jwt } from 'hono/jwt'
import { sign } from 'hono/jwt'

const app = new Hono()

app.use('*', logger())

app.use('*', cors())

const mockInstitutions = [
    {
        id: "OP_OKOYFIHH",
        name: "OP Financial Group",
        bic: "OKOYFIHH",
        transaction_total_days: "729",
        max_access_valid_for_days: "180",
        countries: ["FI"],
    }
]

const mockAccounts = new Map()
const mockRequisitions = new Map()
const mockAgreements = new Map()
const mockTransactions = new Map()

const generateUUID = () => crypto.randomUUID()
const generateIban = () => `GB${Math.floor(Math.random() * 90 + 10)}MOCK${Math.floor(Math.random() * 100000000).toString().padStart(8, '0')}`

const generateTransactionsForAccount = (accountId) => {
    const generateTransaction = (daysAgo, isPending = false) => ({
        transactionId: isPending ? undefined : generateUUID(),
        transactionAmount: {
            amount: (Math.random() * 200 - 100).toFixed(2),
            currency: "EUR"
        },
        bankTransactionCode: "PMNT",
        bookingDate: isPending ? undefined : new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        valueDate: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        remittanceInformationUnstructured: `Mock transaction ${Math.floor(Math.random() * 1000)}`,
        debtorName: Math.random() > 0.5 ? "Mock Merchant" : undefined,
        creditorName: Math.random() > 0.5 ? "Mock Recipient" : undefined
    })

    const bookedTransactions = Array.from({ length: 10 }, (_, i) => generateTransaction(i + 1))
    const pendingTransactions = Array.from({ length: 2 }, () => generateTransaction(0, true))

    return {
        booked: bookedTransactions,
        pending: pendingTransactions,
        last_updated: new Date().toISOString()
    }
}

const jwtMiddleware = jwt({
    secret: 'mock-secret-key',
})

app.post('/api/v2/token/new/', async (c) => {
    const body = await c.req.json()
    const { secret_id, secret_key } = body

    if (!secret_id || !secret_key) {
        return c.json({
            summary: "Authentication failed",
            detail: "No active account found with the given credentials",
            status_code: 401
        }, 401)
    }

    const payload = { sub: secret_id, exp: Math.floor(Date.now() / 1000) + 86400 }
    const accessToken = await sign(payload, 'mock-secret-key')
    const refreshToken = await sign({ sub: secret_id, exp: Math.floor(Date.now() / 1000) + 2592000 }, 'mock-secret-key')

    return c.json({
        access: accessToken,
        access_expires: 86400,
        refresh: refreshToken,
        refresh_expires: 2592000
    })
})

app.post('/api/v2/token/refresh/', async (c) => {
    const body = await c.req.json()
    const { refresh } = body

    if (!refresh) {
        return c.json({
            summary: "Invalid token",
            detail: "Token is invalid or expired",
            status_code: 401
        }, 401)
    }

    const payload = { sub: 'user', exp: Math.floor(Date.now() / 1000) + 86400 }
    const accessToken = await sign(payload, 'mock-secret-key')

    return c.json({
        access: accessToken,
        access_expires: 86400
    })
})

app.get('/api/v2/institutions/', (c) => {
    const country = c.req.query('country')
    let institutions = mockInstitutions

    if (country) {
        institutions = mockInstitutions.filter(inst =>
            inst.countries.includes(country.toUpperCase())
        )
    }

    return c.json(institutions)
})

app.get('/api/v2/institutions/:id/', jwtMiddleware, (c) => {
    const id = c.req.param('id')
    const institution = mockInstitutions.find(inst => inst.id === id)

    if (!institution) {
        return c.json({
            detail: "Not found.",
            summary: "Not found.",
            status_code: 404
        }, 404)
    }

    return c.json(institution)
})

app.post('/api/v2/agreements/enduser/', jwtMiddleware, async (c) => {
    const body = await c.req.json()
    const { institution_id, max_historical_days = 90, access_valid_for_days = 90, access_scope = ["balances", "details", "transactions"] } = body

    if (!institution_id) {
        return c.json({
            institution_id: {
                summary: "This field is required.",
                detail: "Please provide an institution ID"
            },
            status_code: 400
        }, 400)
    }

    const institution = mockInstitutions.find(inst => inst.id === institution_id)
    if (!institution) {
        return c.json({
            institution_id: {
                summary: `Unknown Institution ID ${institution_id}`,
                detail: "Get Institution IDs from /institutions/?country={COUNTRY_CODE}"
            },
            status_code: 400
        }, 400)
    }

    const agreement = {
        id: generateUUID(),
        created: new Date().toISOString(),
        institution_id,
        max_historical_days,
        access_valid_for_days,
        access_scope,
        accepted: null
    }

    mockAgreements.set(agreement.id, agreement)
    return c.json(agreement, 201)
})

app.get('/api/v2/agreements/enduser/', jwtMiddleware, (c) => {
    const limit = parseInt(c.req.query('limit') || '100')
    const offset = parseInt(c.req.query('offset') || '0')

    const agreements = Array.from(mockAgreements.values())
    const paginatedResults = agreements.slice(offset, offset + limit)

    return c.json({
        count: agreements.length,
        next: offset + limit < agreements.length ? `${c.req.url}?limit=${limit}&offset=${offset + limit}` : null,
        previous: offset > 0 ? `${c.req.url}?limit=${limit}&offset=${Math.max(0, offset - limit)}` : null,
        results: paginatedResults
    })
})

app.get('/api/v2/agreements/enduser/:id/', jwtMiddleware, (c) => {
    const id = c.req.param('id')
    const agreement = mockAgreements.get(id)

    if (!agreement) {
        return c.json({
            detail: "Not found.",
            summary: "Not found.",
            status_code: 404
        }, 404)
    }

    return c.json(agreement)
})

app.put('/api/v2/agreements/enduser/:id/accept/', jwtMiddleware, async (c) => {
    const id = c.req.param('id')
    const agreement = mockAgreements.get(id)

    if (!agreement) {
        return c.json({
            detail: "Not found.",
            summary: "Not found.",
            status_code: 404
        }, 404)
    }

    if (agreement.accepted) {
        return c.json({
            summary: "EUA cannot be accepted more than once",
            detail: "End User Agreements cannot be accepted more than once",
            status_code: 405
        }, 405)
    }

    agreement.accepted = new Date().toISOString()
    mockAgreements.set(id, agreement)

    return c.json(agreement)
})

app.delete('/api/v2/agreements/enduser/:id/', jwtMiddleware, (c) => {
    const id = c.req.param('id')
    const agreement = mockAgreements.get(id)

    if (!agreement) {
        return c.json({
            detail: "Not found.",
            summary: "Not found.",
            status_code: 404
        }, 404)
    }

    mockAgreements.delete(id)
    return c.json({
        summary: "End User Agreement deleted",
        detail: `End User Agreement ${id} deleted`
    })
})

app.post('/api/v2/requisitions/', jwtMiddleware, async (c) => {
    const body = await c.req.json()
    const { redirect, institution_id, agreement, reference, user_language, account_selection = false } = body

    if (!redirect || !institution_id) {
        return c.json({
            redirect: !redirect ? ["This field is required."] : undefined,
            institution_id: !institution_id ? ["This field is required."] : undefined,
            status_code: 400
        }, 400)
    }

    const institution = mockInstitutions.find(inst => inst.id === institution_id)
    if (!institution) {
        return c.json({
            institution_id: {
                summary: `Unknown Institution ID ${institution_id}`,
                detail: "Get Institution IDs from /institutions/?country={COUNTRY_CODE}"
            },
            status_code: 400
        }, 400)
    }

    const requisitionId = generateUUID();
    const requisition = {
        id: requisitionId,
        created: new Date().toISOString(),
        redirect,
        status: "CR",
        institution_id,
        agreement: agreement || null,
        reference: reference || null,
        accounts: [],
        user_language: user_language || "en",
        link: `http://localhost:3000/mock-integrations/api/v2/requisitions/${requisitionId}/simulate-successful-connection`,
        account_selection,
        redirect_immediate: false
    }

    mockRequisitions.set(requisition.id, requisition)
    return c.json(requisition, 201)
})

app.get('/api/v2/requisitions/', jwtMiddleware, (c) => {
    const limit = parseInt(c.req.query('limit') || '100')
    const offset = parseInt(c.req.query('offset') || '0')

    const requisitions = Array.from(mockRequisitions.values())
    const paginatedResults = requisitions.slice(offset, offset + limit)

    return c.json({
        count: requisitions.length,
        next: offset + limit < requisitions.length ? `${c.req.url}?limit=${limit}&offset=${offset + limit}` : null,
        previous: offset > 0 ? `${c.req.url}?limit=${limit}&offset=${Math.max(0, offset - limit)}` : null,
        results: paginatedResults
    })
})

app.get('/api/v2/requisitions/:id/', jwtMiddleware, (c) => {
    const id = c.req.param('id')
    const requisition = mockRequisitions.get(id)

    if (!requisition) {
        console.log(`requisition by id ${id} not found`, { mockRequisitions })
        return c.json({
            detail: "Not found.",
            summary: "Not found.",
            status_code: 404
        }, 404)
    }

    return c.json(requisition)
})

app.delete('/api/v2/requisitions/:id/', jwtMiddleware, (c) => {
    const id = c.req.param('id')
    const requisition = mockRequisitions.get(id)

    if (!requisition) {
        return c.json({
            detail: "Not found.",
            summary: "Not found.",
            status_code: 404
        }, 404)
    }

    requisition.accounts?.forEach(accountId => {
        mockAccounts.delete(accountId)
        mockTransactions.delete(accountId) // Clean up transactions too
    })

    mockRequisitions.delete(id)
    return c.json({
        summary: "Requisition deleted",
        detail: `Requisition ${id} deleted with all its End User Agreements`
    })
})

app.get("/api/v2/requisitions/:id/simulate-successful-connection", (c) => {
    const id = c.req.param('id')
    const requisition = mockRequisitions.get(id)
    console.log({ mockRequisitions })

    if (!requisition) {
        return c.json({
            detail: "Not found.",
            summary: "Not found.",
            status_code: 404
        }, 404)
    }

    const accountId1 = generateUUID()
    const accountId2 = generateUUID()

    requisition.accounts = [accountId1, accountId2]
    requisition.status = "LN"

    mockAccounts.set(accountId1, {
        id: accountId1,
        created: new Date().toISOString(),
        last_accessed: new Date().toISOString(),
        iban: generateIban(),
        status: "READY",
        institution_id: requisition.institution_id,
        owner_name: "John Doe",
        name: "Main Account"
    })

    mockAccounts.set(accountId2, {
        id: accountId2,
        created: new Date().toISOString(),
        last_accessed: new Date().toISOString(),
        iban: generateIban(),
        status: "READY",
        institution_id: requisition.institution_id,
        owner_name: "John Doe",
        name: "Savings Account"
    })

    // Generate and store transactions for both accounts
    mockTransactions.set(accountId1, generateTransactionsForAccount(accountId1))
    mockTransactions.set(accountId2, generateTransactionsForAccount(accountId2))

    mockRequisitions.set(id, requisition);

    return c.redirect(requisition.redirect);
});

app.get('/api/v2/accounts/:id/', jwtMiddleware, (c) => {
    const id = c.req.param('id')
    const account = mockAccounts.get(id)

    if (!account) {
        return c.json({
            summary: `Account ID ${id} not found`,
            detail: "Please check whether you specified a valid Account ID",
            status_code: 404
        }, 404)
    }

    return c.json(account)
})

app.get('/api/v2/accounts/:id/balances/', jwtMiddleware, (c) => {
    const id = c.req.param('id')
    const account = mockAccounts.get(id)

    if (!account) {
        return c.json({
            summary: `Account ID ${id} not found`,
            detail: "Please check whether you specified a valid Account ID",
            status_code: 404
        }, 404)
    }

    return c.json({
        balances: [
            {
                balanceAmount: {
                    amount: (Math.random() * 5000 + 1000).toFixed(2),
                    currency: "EUR"
                },
                balanceType: "closingBooked",
                referenceDate: new Date().toISOString().split('T')[0]
            },
            {
                balanceAmount: {
                    amount: (Math.random() * 5000 + 1000).toFixed(2),
                    currency: "EUR"
                },
                balanceType: "expected",
                referenceDate: new Date().toISOString().split('T')[0]
            }
        ]
    })
})

app.get('/api/v2/accounts/:id/details/', jwtMiddleware, (c) => {
    const id = c.req.param('id')
    const account = mockAccounts.get(id)

    if (!account) {
        return c.json({
            summary: `Account ID ${id} not found`,
            detail: "Please check whether you specified a valid Account ID",
            status_code: 404
        }, 404)
    }

    return c.json({
        account: {
            resourceId: account.id,
            iban: account.iban,
            currency: "EUR",
            ownerName: account.owner_name,
            name: account.name,
            product: "Current Account",
            cashAccountType: "CACC"
        }
    })
})

app.get('/api/v2/accounts/:id/transactions/', jwtMiddleware, (c) => {
    const id = c.req.param('id')
    const account = mockAccounts.get(id)

    if (!account) {
        return c.json({
            summary: `Account ID ${id} not found`,
            detail: "Please check whether you specified a valid Account ID",
            status_code: 404
        }, 404)
    }

    const transactions = mockTransactions.get(id)

    if (!transactions) {
        return c.json({
            summary: `No transactions found for account ${id}`,
            detail: "Account may not have been properly initialized",
            status_code: 404
        }, 404)
    }

    return c.json({
        transactions: {
            booked: transactions.booked,
            pending: transactions.pending
        },
        last_updated: transactions.last_updated
    })
})

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

app.notFound((c) => {
    return c.json({
        detail: "Not found.",
        summary: "Not found.",
        status_code: 404
    }, 404)
})

export default {
    port: 8002,
    hostname: '0.0.0.0',
    fetch: app.fetch,
}
