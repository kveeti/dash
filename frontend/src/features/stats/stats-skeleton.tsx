export function StatsSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-6">
        <h1
          className="m-0 my-1 block h-[1em] max-w-full rounded-lg bg-gray-150 text-xl font-medium motion-safe:animate-pulse"
          style={{ inlineSize: "11rem" }}
        />
        <p
          className="my-1 block h-[1em] max-w-full rounded-lg bg-gray-150 text-sm text-gray-700 motion-safe:animate-pulse"
          style={{ inlineSize: "15rem" }}
        />
      </div>
      <section className="mb-6 flex w-full flex-col gap-2 min-[30rem]:flex-row">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[5.5rem] w-full rounded-2xl bg-gray-150 motion-safe:animate-pulse"
          />
        ))}
      </section>
      <div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="my-4 h-5 rounded-lg bg-gray-150 motion-safe:animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
