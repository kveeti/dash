import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { BanknotesIcon } from "@heroicons/react/24/outline";

import { useCurrenciesQuery } from "../../../api/currencies";
import { useMeQuery } from "../../../api/user";
import { setSearchParams, useSearchParam } from "../../../lib/search-param";
import { Input, Select } from "../../../ui/input/input";
import { TabPanel, TabTrigger } from "./filter-button";

export function Trigger(props: { applied: boolean }) {
  return (
    <TabTrigger
      value="amount"
      label="Amount"
      Icon={BanknotesIcon}
      applied={props.applied}
    />
  );
}

export function Panel() {
  const direction = useSearchParam("direction") ?? "";
  const amount = useSearchParam("amount") ?? "";
  const minimum = useSearchParam("amount_min") ?? "";
  const maximum = useSearchParam("amount_max") ?? "";
  const currency = useSearchParam("currency");
  const currencies = useCurrenciesQuery();
  const me = useMeQuery();
  const selectedCurrency = currency ?? me.data?.home_currency ?? "";
  const update = (values: Record<string, string | undefined>) =>
    setSearchParams(values, { replace: true });

  return (
    <TabPanel value="amount">
      <section aria-label="Amount filter" className="space-y-5">
        <h2 className="font-medium">Amount</h2>
        <fieldset>
          <legend className="mb-2 text-sm text-gray-700">Direction</legend>
          <RadioGroup
            name="direction"
            value={direction}
            onValueChange={(value) => update({ direction: value || undefined })}
            className="flex items-center gap-4"
          >
            {[
              ["", "Any"],
              ["in", "In"],
              ["out", "Out"],
            ].map(([value, label]) => (
              <label
                key={value}
                className="inline-flex cursor-pointer items-center gap-2 text-sm"
              >
                <Radio.Root
                  value={value}
                  className="flex size-[1.15rem] shrink-0 items-center justify-center rounded-full border border-gray-350 bg-(--input-bg)/80 p-0 outline-[1.5px] outline-transparent outline-offset-2 hover:bg-(--input-bg-alt)/80 focus-visible:outline-gray-500 data-checked:border-success-solid"
                >
                  <Radio.Indicator className="size-[.55rem] rounded-full bg-success-solid data-unchecked:hidden" />
                </Radio.Root>
                {label}
              </label>
            ))}
          </RadioGroup>
        </fieldset>
        <label className="block text-sm text-gray-700">
          Currency
          <Select
            className="mt-1"
            value={selectedCurrency}
            onChange={(event) =>
              update({ currency: event.currentTarget.value || undefined })
            }
          >
            <option value="">Select currency</option>
            {(currencies.data ?? []).map((item) => (
              <option key={item.code} value={item.code}>
                {item.code}
              </option>
            ))}
          </Select>
        </label>
        <div className="grid grid-cols-2 gap-3 min-[26rem]:grid-cols-3">
          <label className="col-span-2 text-sm text-gray-700 min-[26rem]:col-span-1">
            Specific amount
            <Input
              className="mt-1"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                const value = event.currentTarget.value;
                update({
                  amount: value || undefined,
                  amount_min: undefined,
                  amount_max: undefined,
                  currency: value ? selectedCurrency || undefined : undefined,
                });
              }}
              iconLeft="="
            />
          </label>
          <label className="text-sm text-gray-700">
            At least...
            <Input
              className="mt-1"
              inputMode="decimal"
              value={minimum}
              onChange={(event) => {
                const value = event.currentTarget.value;
                update({
                  amount: undefined,
                  amount_min: value || undefined,
                  currency:
                    value || maximum
                      ? selectedCurrency || undefined
                      : undefined,
                });
              }}
              iconLeft="≥"
            />
          </label>
          <label className="text-sm text-gray-700">
            No more than...
            <Input
              className="mt-1"
              inputMode="decimal"
              value={maximum}
              onChange={(event) => {
                const value = event.currentTarget.value;
                update({
                  amount: undefined,
                  amount_max: value || undefined,
                  currency:
                    value || minimum
                      ? selectedCurrency || undefined
                      : undefined,
                });
              }}
              iconLeft="≤"
            />
          </label>
        </div>
      </section>
    </TabPanel>
  );
}
