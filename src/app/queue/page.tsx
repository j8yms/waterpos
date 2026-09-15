import RoleGuard from "@/components/RoleGuard";
import RiderQueue from "@/components/riders/RiderQueue";

export default function QueuePage() {
  return (
    <RoleGuard role="rider">
      <RiderQueue />
    </RoleGuard>
  );
}