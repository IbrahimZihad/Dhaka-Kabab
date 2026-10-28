import { orderStatusLabel, type PlacedOrder } from "@/lib/order-submit";

const STATUS_TONE: Record<string, string> = {
  PENDING: "badge",
  CONFIRMED: "badge badge-brand",
  PREPARING: "badge badge-brand",
  READY: "badge badge-open",
  SERVED: "badge badge-open",
  COMPLETED: "badge badge-open",
  CANCELLED: "badge badge-closed",
};

/** One order, as the guest sees it. Prices are the restaurant's own strings. */
export function OrderCard({ order, showTimeline = true }: { order: PlacedOrder; showTimeline?: boolean }) {
  return (
    <article className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Order {order.orderNumber}</h2>
          <p className="hint mt-1">
            {order.type === "DINE_IN" && order.table
              ? `Table ${order.table}`
              : order.type === "TAKEAWAY"
                ? "Takeaway collection"
                : order.type === "DELIVERY"
                  ? "Delivery"
                  : "Order"}{" "}
            · placed {new Date(order.createdAt).toLocaleString()}
          </p>
        </div>
        <span className={STATUS_TONE[order.status] ?? "badge"}>{orderStatusLabel(order.status)}</span>
      </div>

      <ul className="mt-4 divide-y divide-line text-sm">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="font-medium">{item.quantity}×</span> {item.name}
              {item.options.length ? <span className="hint block">{item.options.join(", ")}</span> : null}
              {item.instructions ? <span className="hint block italic">“{item.instructions}”</span> : null}
            </span>
            <span className="price shrink-0">{item.lineTotal}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
        <Row label="Food" value={order.totals.subtotal} />
        {order.totals.poisa.discountPoisa > 0 ? <Row label="Discount" value={order.totals.discount} /> : null}
        <Row label="Service charge" value={order.totals.serviceCharge} />
        <Row label="VAT" value={order.totals.vat} />
        {order.type === "DELIVERY" ? <Row label="Delivery" value={order.totals.deliveryFee} /> : null}
        <div className="flex justify-between pt-1 text-base font-semibold">
          <dt>Total</dt>
          <dd className="price">{order.totals.total}</dd>
        </div>
      </dl>

      {order.specialInstructions ? (
        <p className="hint mt-3">Your note: “{order.specialInstructions}”</p>
      ) : null}
      {order.cancelledReason ? (
        <p className="notice notice-error mt-3">Cancelled: {order.cancelledReason}</p>
      ) : null}

      {showTimeline && order.timeline.length > 0 ? (
        <ol className="mt-4 space-y-1 text-xs soft">
          {order.timeline.map((event, index) => (
            <li key={`${event.status}-${index}`}>
              {orderStatusLabel(event.status)} — {new Date(event.at).toLocaleTimeString()}
            </li>
          ))}
        </ol>
      ) : null}

      {order.readyAt ? (
        <p className="notice notice-ok mt-3">
          Ready at {new Date(order.readyAt).toLocaleTimeString()} — please collect it from the counter.
        </p>
      ) : null}
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
