import { Suspense } from "react";
import { FloorBoard, FloorBoardSkeleton } from "@/components/admin/floor-board";

/**
 * The floor board: the screen a manager or cashier runs the room from. Every
 * read below (the signed-in role, the tables, the live sessions) is request-time
 * data, so it all streams inside one `<Suspense>` boundary and the page's
 * default export never awaits anything itself. Filters come from `searchParams`,
 * read inside that boundary, so a filtered board can be shared or reloaded.
 */
export default function AdminFloorPage(props: PageProps<"/admin/floor">) {
  return (
    <Suspense fallback={<FloorBoardSkeleton />}>
      <FloorBoard searchParams={props.searchParams} />
    </Suspense>
  );
}
