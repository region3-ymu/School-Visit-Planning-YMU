import SchoolProfileView from "./SchoolProfileView";

export default async function SchoolHomePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SchoolProfileView schoolId={id} />;
}
