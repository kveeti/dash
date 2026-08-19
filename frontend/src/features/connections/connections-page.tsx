import { Field as FormField, Form, useForm } from "@formisch/react";
import { useId, useState } from "react";
import * as v from "valibot";

import { useBucketsQuery } from "../../api/buckets";
import {
  useDeleteEnableBankingConnection,
  useEnableBankingConnections,
  useMapEnableBankingAccount,
  useSyncEnableBankingAccounts,
  type EnableBankingAccount,
  type EnableBankingConnection,
} from "../../api/enablebanking";
import { Button } from "../../ui/button/button";
import { Checkbox } from "../../ui/checkbox/checkbox";
import { Field } from "../../ui/input/field";
import { Input } from "../../ui/input/input";
import { Select } from "../../ui/input/select";
import { BucketPicker } from "../buckets/bucket-picker";

const connectSchema = v.object({
  country: v.pipe(v.string(), v.length(2, "Use a two-letter country code")),
  bank: v.pipe(v.string(), v.nonEmpty("Enter the bank name")),
  psuType: v.picklist(["personal", "business"]),
});

export default function ConnectionsPage() {
  const connections = useEnableBankingConnections();
  const sync = useSyncEnableBankingAccounts();
  const selectAllId = useId();
  const [deselected, setDeselected] = useState(() => new Set<string>());
  const feeds = (connections.data ?? []).flatMap((connection) =>
    connection.accounts.map((account) => ({
      connectionId: connection.id,
      account,
      key: `${connection.id}:${account.uid}`,
    })),
  );
  const selectedFeeds = feeds.filter((feed) => !deselected.has(feed.key));
  const allSelected = feeds.length > 0 && selectedFeeds.length === feeds.length;
  const someSelected = selectedFeeds.length > 0 && !allSelected;

  return (
    <main className="mx-auto flex w-full max-w-(--page-width) flex-col gap-12 px-3 pt-6 sm:px-6">
      <section>
        <h1 className="mb-3 text-lg font-medium">Connect a bank</h1>
        <ConnectForm />
      </section>
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Bank connections</h2>
          {feeds.length > 0 && (
            <div className="flex items-center gap-4">
              <Checkbox
                id={selectAllId}
                checked={allSelected}
                indeterminate={someSelected}
                onCheckedChange={() =>
                  setDeselected(
                    allSelected
                      ? new Set(feeds.map((feed) => feed.key))
                      : new Set(),
                  )
                }
              />
              <label className="sr-only" htmlFor={selectAllId}>
                Select all bank accounts
              </label>
              <Button
                type="button"
                onClick={() => {
                  if (sync.isPending) return;
                  sync.mutate(
                    selectedFeeds.map((feed) => ({
                      connectionId: feed.connectionId,
                      accountUid: feed.account.uid,
                    })),
                  );
                }}
              >
                Sync
              </Button>
            </div>
          )}
        </div>
        {(connections.isError || sync.isError) && (
          <p className="mb-3 text-danger-fg">
            {connections.error?.message ?? sync.error?.message}
          </p>
        )}
        {connections.isPending && <p>Loading…</p>}
        {connections.data?.length === 0 && <p>No banks connected.</p>}
        <div className="flex flex-col gap-6">
          {connections.data?.map((connection) => (
            <Connection
              key={connection.id}
              connection={connection}
              isSelected={(account) =>
                !deselected.has(`${connection.id}:${account.uid}`)
              }
              onSelectedChange={(account, selected) => {
                const key = `${connection.id}:${account.uid}`;
                setDeselected((current) => {
                  const next = new Set(current);
                  if (selected) next.delete(key);
                  else next.add(key);
                  return next;
                });
              }}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

function ConnectForm() {
  const form = useForm({
    schema: connectSchema,
    initialInput: { country: "FI", bank: "", psuType: "personal" },
  });
  return (
    <Form
      of={form}
      className="-mx-3 flex flex-col gap-4 rounded-2xl border border-border-subtle bg-form p-6 min-[30rem]:grid min-[30rem]:grid-cols-[auto_minmax(0,22rem)] min-[30rem]:items-center min-[30rem]:gap-x-8 min-[30rem]:gap-y-3 min-[30rem]:[&>*]:col-span-full sm:-mx-6"
      onSubmit={(input) => {
        const params = new URLSearchParams({
          country: input.country.toUpperCase(),
          bank: input.bank,
          psu_type: input.psuType,
        });
        window.location.assign(`/api/v1/enablebanking/connect?${params}`);
      }}
    >
      <FormField of={form} path={["country"]}>
        {(field) => (
          <Field label="Country" error={field.errors?.[0]}>
            <Input
              {...field.props}
              value={field.input ?? ""}
              maxLength={2}
              autoCapitalize="characters"
            />
          </Field>
        )}
      </FormField>
      <FormField of={form} path={["bank"]}>
        {(field) => (
          <Field label="Enable Banking bank name" error={field.errors?.[0]}>
            <Input
              {...field.props}
              value={field.input ?? ""}
              placeholder="Revolut"
            />
          </Field>
        )}
      </FormField>
      <FormField of={form} path={["psuType"]}>
        {(field) => (
          <Field label="Account type">
            <Select {...field.props} value={field.input ?? "personal"}>
              <option value="personal">Personal</option>
              <option value="business">Business</option>
            </Select>
          </Field>
        )}
      </FormField>
      <div className="mt-4">
        <Button type="submit" className="w-full">
          Continue to bank
        </Button>
      </div>
    </Form>
  );
}

function Connection(props: {
  connection: EnableBankingConnection;
  isSelected: (account: EnableBankingAccount) => boolean;
  onSelectedChange: (account: EnableBankingAccount, selected: boolean) => void;
}) {
  const remove = useDeleteEnableBankingConnection();
  const accountsByIban = new Map<string, EnableBankingAccount[]>();
  for (const account of props.connection.accounts) {
    const accounts = accountsByIban.get(account.iban) ?? [];
    accounts.push(account);
    accountsByIban.set(account.iban, accounts);
  }
  return (
    <article className="-mx-3 rounded-2xl border border-border-subtle bg-form p-6 sm:-mx-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium">
            {props.connection.bank} · {props.connection.country}
          </h3>
          <p className="text-base text-gray-700">
            Access until{" "}
            {new Date(props.connection.expires_at).toLocaleDateString()}
          </p>
        </div>
        <a
          className="text-base underline"
          href={`/api/v1/enablebanking/connect?integration_id=${props.connection.id}`}
        >
          Reconnect
        </a>
      </div>
      <ul className="mt-5 flex list-none flex-col gap-4 p-0">
        {[...accountsByIban].map(([iban, accounts]) => (
          <AccountGroup
            key={iban}
            connection={props.connection}
            accounts={accounts}
            isSelected={props.isSelected}
            onSelectedChange={props.onSelectedChange}
          />
        ))}
      </ul>
      <div className="mt-5">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            if (!remove.isPending) remove.mutate(props.connection.id);
          }}
        >
          Disconnect
        </Button>
      </div>
      {remove.isError && (
        <p className="mt-2 text-danger-fg">{remove.error.message}</p>
      )}
    </article>
  );
}

function AccountGroup(props: {
  connection: EnableBankingConnection;
  accounts: EnableBankingAccount[];
  isSelected: (account: EnableBankingAccount) => boolean;
  onSelectedChange: (account: EnableBankingAccount, selected: boolean) => void;
}) {
  const account = props.accounts[0];
  const buckets = useBucketsQuery();
  const map = useMapEnableBankingAccount();
  const mapped = buckets.data?.find(
    (bucket) => bucket.id === account.bucket_id,
  );
  const checkboxId = useId();
  const multipleFeeds = props.accounts.length > 1;
  return (
    <li className="border-t border-border-subtle pt-4 first:border-0 first:pt-0">
      {multipleFeeds ? (
        <>
          <p className="font-medium">{account.name || account.iban}</p>
          <p className="text-base text-gray-700">{account.iban}</p>
          <ul className="mt-3 flex list-none flex-col gap-3 p-0">
            {props.accounts.map((feed, index) => {
              const id = `${checkboxId}-${index}`;
              return (
                <li key={feed.uid} className="flex items-center gap-3">
                  <Checkbox
                    id={id}
                    checked={props.isSelected(feed)}
                    onCheckedChange={(checked) =>
                      props.onSelectedChange(feed, checked)
                    }
                  />
                  <label
                    className="cursor-pointer text-base text-gray-700"
                    htmlFor={id}
                  >
                    {feed.currency}
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="flex items-start gap-3">
          <Checkbox
            id={checkboxId}
            className="mt-0.5"
            checked={props.isSelected(account)}
            onCheckedChange={(checked) =>
              props.onSelectedChange(account, checked)
            }
          />
          <label className="min-w-0 cursor-pointer" htmlFor={checkboxId}>
            <span className="block font-medium">
              {account.name || account.iban}
            </span>
            <span className="block text-base text-gray-700">
              {account.iban} · {account.currency}
            </span>
          </label>
        </div>
      )}
      <div className="mt-3">
        <BucketPicker
          kinds={["asset", "liability"]}
          createKinds={["asset", "liability"]}
          placeholder="Map to an account"
          value={mapped ?? null}
          onPick={(bucket) => {
            if (map.isPending) return;
            map.mutate({
              connectionId: props.connection.id,
              accountUid: account.uid,
              bucketId: bucket.id,
              bucketName: bucket.name,
              iban: account.iban,
            });
          }}
        />
      </div>
      {map.isError && (
        <p className="mt-2 text-danger-fg">{map.error.message}</p>
      )}
    </li>
  );
}
