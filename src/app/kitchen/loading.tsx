export default function KitchenLoading() {
  return (
    <div className="space-y-4">
      <span className="skeleton block h-9 w-48" />
      <div className="grid gap-6 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <span key={index} className="skeleton block h-96" />
        ))}
      </div>
    </div>
  );
}
