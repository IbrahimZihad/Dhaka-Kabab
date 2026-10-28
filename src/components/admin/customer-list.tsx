import Link from "next/link";
import { formatInZone } from "@/lib/time";
import { listCustomers, listWalkInGuests } from "@/server/services/customer.service";
import { AdminTable } from "@/components/admin/admin-ui";

/**
 * Registered diners, rendered straight from the customer service. The order
 * count and spend are the service's own numbers — summed from stored order
 * totals over the selected window, cancelled orders excluded — so nothing on
 * these rows is worked out in the browser.
 */
export type RegisteredCustomerRow = Awaited<ReturnType<typeof listCustomers>>["customers"][number];

/** Diners who paid through a table QR without ever making an account. */
export type WalkInGuestRow = Awaited<ReturnType<typeof listWalkInGuests>>[number];

function ActiveBadge({ isActive }: { isActive: boolean }) {
  return <span className={isActive ? "badge badge-open" : "badge badge-closed"}>{isActive ? "Active" : "Deactivated"}</span>;
}

export function RegisteredCustomerTable({ customers, timeZone }: { customers: RegisteredCustomerRow[]; timeZone: string }) {
  return (
    <AdminTable head={["Customer", "Phone", "Orders", "Spend", "Last order", "Status", "Open"]}>
      {customers.map((customer) => (
        <tr key={customer.id} className="border-b border-line align-top">
          <td className="px-3 py-2">
            <Link href={`/admin/customers/${customer.id}`} className="font-semibold hover:text-brand">
              {customer.name}
            </Link>
            <p className="muted break-all">{customer.email}</p>
          </td>
          <td className="px-3 py-2 soft">{customer.phone ?? <span className="muted">not recorded</span>}</td>
          <td className="px-3 py-2 tabular-nums soft">{customer.spend.orders}</td>
          <td className="px-3 py-2 tabular-nums soft">{customer.spendLabel}</td>
          <td className="px-3 py-2 whitespace-nowrap soft">
            {customer.spend.lastOrderAt ? formatInZone(customer.spend.lastOrderAt, timeZone) : "No orders yet"}
          </td>
          <td className="px-3 py-2">
            <ActiveBadge isActive={customer.isActive} />
          </td>
          <td className="px-3 py-2">
            <Link href={`/admin/customers/${customer.id}`} className="btn btn-ghost btn-sm">
              Open
            </Link>
          </td>
        </tr>
      ))}
    </AdminTable>
  );
}

/**
 * The contact snapshot stored on each order. These guests never signed up, so an
 * email, an account status and a delivery address do not exist for them — the
 * only fields available are the name and number the QR order captured.
 */
export function WalkInGuestTable({ guests, timeZone }: { guests: WalkInGuestRow[]; timeZone: string }) {
  return (
    <AdminTable head={["Guest", "Phone", "Orders", "Spend", "Last visit"]}>
      {guests.map((guest) => (
        <tr key={`${guest.phone}-${guest.name}`} className="border-b border-line align-top">
          <td className="px-3 py-2">
            <p className="font-semibold">{guest.name}</p>
            <p className="muted">Unregistered — no account, email or address on file</p>
          </td>
          <td className="px-3 py-2 soft">{guest.phone || <span className="muted">not captured</span>}</td>
          <td className="px-3 py-2 tabular-nums soft">{guest.orders}</td>
          <td className="px-3 py-2 tabular-nums soft">{guest.spendLabel}</td>
          <td className="px-3 py-2 whitespace-nowrap soft">
            {guest.lastVisit ? formatInZone(guest.lastVisit, timeZone) : "No visit recorded"}
          </td>
        </tr>
      ))}
    </AdminTable>
  );
}
