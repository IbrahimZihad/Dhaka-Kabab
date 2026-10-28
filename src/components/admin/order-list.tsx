import Link from "next/link";
import { ORDER_STATUS_LABELS, ORDER_TYPE_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/staff-format";
import { formatInZone } from "@/lib/time";
import type { staffOrder } from "@/server/http/order-view";
import { AdminTable, StatusBadge } from "@/components/admin/admin-ui";

/**
 * One order as the staff projection returns it. Screens render nothing but this
 * shape, so a row can never leak money or a phone number the server withheld —
 * `staffOrder` decides that, and `financials` is only ever true for the roles
 * that may see it.
 */
export type OrderView = ReturnType<typeof staffOrder>;

function statusLabel(status: string): string {
  return ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS] ?? status;
}

function typeLabel(type: string): string {
  return ORDER_TYPE_LABELS[type as keyof typeof ORDER_TYPE_LABELS] ?? type;
}

function paymentLabel(status: string): string {
  return PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS] ?? status;
}

/**
 * The order list, shared by the orders screen and anywhere else a manager wants
 * a compact run of orders. Money and the guest's number appear only when the
 * projection carries them.
 */
export function OrderList({
  orders,
  timeZone,
  financials,
}: {
  orders: OrderView[];
  timeZone: string;
  financials: boolean;
}) {
  const head = ["Order", "Type", "Where", "Taken", "Dishes", "Payment", "Status"];
  if (financials) head.push("Total");
  head.push("Open");

  return (
    <AdminTable head={head}>
      {orders.map((order) => {
        const dishes = order.items.reduce((total, item) => total + item.quantity, 0);
        return (
          <tr key={order.id} className="border-b border-line align-top">
            <td className="px-3 py-2">
              <Link href={`/admin/orders/${order.id}`} className="font-mono font-semibold hover:text-brand">
                {order.orderNumber}
              </Link>
              {order.isDemo ? <span className="badge ml-2">sample</span> : null}
            </td>
            <td className="px-3 py-2 soft">{typeLabel(order.type)}</td>
            <td className="px-3 py-2 soft">{order.table ? `Table ${order.table}` : "Not a table"}</td>
            <td className="px-3 py-2 muted whitespace-nowrap">{formatInZone(new Date(order.createdAt), timeZone)}</td>
            <td className="px-3 py-2 tabular-nums soft">
              {dishes} item{dishes === 1 ? "" : "s"}
            </td>
            <td className="px-3 py-2 soft">{paymentLabel(order.paymentStatus)}</td>
            <td className="px-3 py-2">
              <StatusBadge status={statusLabel(order.status)} />
            </td>
            {financials ? (
              <td className="px-3 py-2">
                <span className="price">{"money" in order ? order.money.total : "not shown"}</span>
              </td>
            ) : null}
            <td className="px-3 py-2">
              <Link href={`/admin/orders/${order.id}`} className="btn btn-ghost btn-sm">
                Open
              </Link>
            </td>
          </tr>
        );
      })}
    </AdminTable>
  );
}
