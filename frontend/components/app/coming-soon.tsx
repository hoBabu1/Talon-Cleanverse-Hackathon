export default function ComingSoon({ title, layer }: { title: string; layer: string }) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6 md:min-h-screen">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <p className="mt-2 text-sm text-muted">{layer}</p>
      </div>
    </div>
  );
}
