import TeacherProfileView from "./TeacherProfileView";

export default async function TeacherPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="max-w-5xl mx-auto p-6">
      <TeacherProfileView teacherId={id} />
    </div>
  );
}
