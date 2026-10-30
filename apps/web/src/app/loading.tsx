import { Skeleton } from "@/components/stitch";

// Route-level skeleton with the same page layout as every list page.
export default function Loading() {
  return (
    <div className="sr-page" aria-busy="true" aria-live="polite">
      <div className="sr-topline">
        <div className="sr-grow">
          <div className="sr-skel" style={{ width: 160, height: 24 }} />
          <div className="sr-skel" style={{ width: 280, marginTop: 8 }} />
        </div>
      </div>
      <Skeleton lines={3} />
      <Skeleton lines={4} />
      <Skeleton lines={2} />
    </div>
  );
}
