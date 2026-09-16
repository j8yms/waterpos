import RoleGuard from "@/components/RoleGuard";
import Catalog from "@/components/Catalog";

export default function CatalogPage() {
  return (
    <RoleGuard role="management">
      <Catalog />
    </RoleGuard>
  );
}