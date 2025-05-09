import { api } from "../../api";
import { Link } from "../../ui/link";

export default function TransactionPage() {
	const q = api.useQuery("post", "/transactions/query", {
		body: { search_text: "" },
	});

	return (
		<main className="w-full max-w-[320px]">
			<h1 className="mb-4 text-lg font-medium">transactions</h1>
			<Link href="/txs/new">new</Link>

			{q.isLoading && <p>loading...</p>}
			{q.isSuccess && (
				<ul>
					{q.data.map((transaction) => (
						<li key={transaction.id}>
							<p>{transaction.counter_party}</p>
							<p>{transaction.amount}</p>
							<p>{transaction.date}</p>
							<p>{transaction.additional}</p>
						</li>
					))}
				</ul>
			)}
		</main>
	);
}
