import RoleGuard from "@/components/RoleGuard";
import Customers from "@/components/Customers";

export default function CustomersPage() {
  return (
    <RoleGuard role="management">
      <Customers />
    </RoleGuard>
  );
}