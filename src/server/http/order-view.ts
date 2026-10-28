import { formatPoisa } from "@/lib/money";
import { optionLabels } from "@/server/http/option-labels";

/**
 * Staff- and kitchen-facing order projections.
 *
 * The kitchen display is authenticated but deliberately lossy: a cook needs the
 * dish, the table and any allergen note, not the guest's phone number or the
 * margin on the plate. `financials: false` is applied server-side, so the
 * omission does not depend on which columns the browser asked for.
 */

type OrderRow = {
  id: string;
  orderNumber: string;
  type: string;
  status: string;
  paymentStatus: string;
  createdAt: Date;
  updatedAt: Date;
  readyAt: Date | null;
  cancelledAt: Date | null;
  cancelledReason: string | null;
  specialInstructions: string | null;
  internalNote: string | null;
  contactName: string | null;
  contactPhone: string | null;
  deliveryAddress: string | null;
  subtotalPoisa: number;
  discountPoisa: number;
  serviceChargePoisa: number;
  vatPoisa: number;
  deliveryFeePoisa: number;
  paidPoisa: number;
  totalPoisa: number;
  isDemo: boolean;
  publicToken: string;
  tableId: string | null;
  sessionId: string | null;
  items: { id: string; nameSnapshot?: string; quantity: number; instructions?: string | null; optionsSnapshot?: unknown }[];
  table?: { label: string } | null;
  statusEvents?: { toStatus: string; createdAt: Date }[];
};

export function staffOrder(order: OrderRow, symbol: string, options: { financials: boolean }) {
  const base = {
    id: order.id,
    orderNumber: order.orderNumber,
    type: order.type,
    status: order.status,
    paymentStatus: order.paymentStatus,
    table: order.table?.label ?? null,
    tableId: order.tableId,
    sessionId: order.sessionId,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    readyAt: order.readyAt?.toISOString() ?? null,
    cancelledAt: order.cancelledAt?.toISOString() ?? null,
    cancelledReason: order.cancelledReason,
    specialInstructions: order.specialInstructions,
    internalNote: order.internalNote,
    isDemo: order.isDemo,
    items: order.items.map((item) => ({
      id: item.id,
      name: item.nameSnapshot ?? "(item)",
      quantity: item.quantity,
      instructions: item.instructions ?? null,
      options: optionLabels(item.optionsSnapshot),
    })),
    timeline: (order.statusEvents ?? []).map((event) => ({ status: event.toStatus, at: event.createdAt.toISOString() })),
  };

  if (!options.financials) return base;

  return {
    ...base,
    guest: order.contactName ?? null,
    phone: order.contactPhone ?? null,
    deliveryAddress: order.deliveryAddress,
    trackToken: order.publicToken,
    money: {
      subtotalPoisa: order.subtotalPoisa,
      discountPoisa: order.discountPoisa,
      serviceChargePoisa: order.serviceChargePoisa,
      vatPoisa: order.vatPoisa,
      deliveryFeePoisa: order.deliveryFeePoisa,
      paidPoisa: order.paidPoisa,
      totalPoisa: order.totalPoisa,
      subtotal: formatPoisa(order.subtotalPoisa, { symbol }),
      total: formatPoisa(order.totalPoisa, { symbol }),
      outstandingPoisa: Math.max(0, order.totalPoisa - order.paidPoisa),
      outstanding: formatPoisa(Math.max(0, order.totalPoisa - order.paidPoisa), { symbol }),
    },
  };
}
