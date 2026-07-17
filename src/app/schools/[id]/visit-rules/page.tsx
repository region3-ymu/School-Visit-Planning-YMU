import { prisma } from "@/lib/prisma";
import VisitRulesClient from "./VisitRulesClient";

export default async function VisitRulesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: schoolId } = await params;

  const [school, rules] = await Promise.all([
    prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } }),
    prisma.visitRule.findMany({ where: { schoolId }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <VisitRulesClient
      schoolId={schoolId}
      schoolName={school?.name ?? "School"}
      initialRules={rules}
    />
  );
}
