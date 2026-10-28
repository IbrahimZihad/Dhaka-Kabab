import { Suspense } from "react";
import { QrSheet, QrSheetSkeleton } from "@/components/admin/qr-sheet";

/**
 * Table codes: the screen staff print the QR stickers from. Every read below
 * (the signed-in role, the tables, the filters) is request-time data, so it all
 * streams inside one `<Suspense>` boundary and the page's default export never
 * awaits anything itself. Filters come from `searchParams`, read inside that
 * boundary, so a filtered sheet can be shared or reloaded.
 */
export default function AdminQrPage(props: PageProps<"/admin/qr">) {
  return (
    <Suspense fallback={<QrSheetSkeleton />}>
      <QrSheet searchParams={props.searchParams} />
    </Suspense>
  );
}
