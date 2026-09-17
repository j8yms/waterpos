import RoleGuard from "@/components/RoleGuard";
import RiderQueue from "@/components/riders/RiderQueue";

export default function RiderPosPage() {
  return (
    <RoleGuard role="rider">
      <RiderQueue />
    </RoleGuard>
  );
}