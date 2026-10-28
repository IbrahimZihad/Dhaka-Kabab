export default function Loading() {
  return (
    <div className="shell py-12">
      <span className="skeleton block h-9 w-52" />
      <span className="skeleton mt-4 block h-4 w-80" />
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <span key={index} className="skeleton block h-56" />
        ))}
      </div>
    </div>
  );
}
