import { endOfYear, startOfYear } from "date-fns";
import { format } from "date-fns/format";
import { subYears } from "date-fns/subYears";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { trpc } from "../../lib/trpc";

export function TransactionStatsPage() {
  const now = new Date();
  const lastYear = subYears(now, 1);

  const q = trpc.v1.transactions.stats.useQuery({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    start: startOfYear(lastYear),
    end: endOfYear(lastYear),
    frequency: "monthly",
  });

  if (q.error) {
    <p>error</p>;
  }

  if (q.isLoading) {
    return <div>loading...</div>;
  }

  if (!q.data) {
    return null;
  }

  const { stats, negCategories, posCategories } = q.data;
  const colorsNegCategories = negCategories.map((_, i) => {
    const hue = ((i + 1) * 360) / negCategories.length;
    const lightness = i % 2 === 0 ? 40 : 60;
    const saturation = 70;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  });

  const colorPosCategories = posCategories.map((_, i) => {
    const hue = (i + 1 * 180) / posCategories.length;
    const lightness = i % 2 === 0 ? 40 : 60;
    const saturation = 70;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  });

  return (
    <div className="w-full h-full">
      <ResponsiveContainer width={"100%"} height={350}>
        <BarChart data={stats} stackOffset="sign">
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="currentColor"
            className="text-gray-6"
          />
          <XAxis
            dataKey="period"
            tickFormatter={(date) => format(date, "MMM yy")}
          />
          <YAxis
            domain={[
              -3000,
              (dataMax: number) => {
                const maxNearestThousand = Math.round(dataMax / 1000) * 1000;
                return Math.max(maxNearestThousand + 1000, 3000);
              },
            ]}
          />

          <Tooltip
            isAnimationActive={false}
            cursor={false}
            content={(props) => {
              if (!props.label || !props.payload) return null;
              const label = format(props.label, "MMM yy");
              const things = [...props.payload].reverse(); // TODO: dont like this

              const pos = [];
              const neg = [];

              for (let i = 0; i < things.length; i++) {
                const thing = things[i];
                if (typeof thing?.value !== "number") continue;

                if (thing.value > 0) pos.push(thing);
                else neg.push(thing);
              }

              return (
                <div className="bg-gray-4/50 backdrop-blur-sm p-2">
                  <p className="font-medium mb-1">{label}</p>
                  <ul className="mb-1.5">
                    {pos.map((p) => {
                      return (
                        <li className="flex items-center justify-between gap-2">
                          <div className="flex items-center">
                            <div
                              style={{ backgroundColor: p.color }}
                              className="size-3 me-2"
                            ></div>
                            <span className="text-sm me-2">{p.dataKey}</span>
                          </div>
                          <span className="text-sm">
                            {Math.round(p.value as number)} €
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <ul>
                    {neg.map((p) => {
                      return (
                        <li className="flex items-center justify-between gap-2">
                          <div className="flex items-center">
                            <div
                              style={{ backgroundColor: p.color }}
                              className="size-3 me-2"
                            ></div>
                            <span className="text-sm me-2">{p.dataKey}</span>
                          </div>
                          <span className="text-sm">
                            {Math.round(p.value as number)} €
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            }}
          />
          {negCategories.map((p, i) => (
            <Bar
              key={p}
              dataKey={p}
              stackId="a"
              fill={colorsNegCategories[i]}
              isAnimationActive={false}
            />
          ))}

          {posCategories.map((p, i) => (
            <Bar
              key={p}
              dataKey={p}
              stackId="a"
              fill={colorPosCategories[i]}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
