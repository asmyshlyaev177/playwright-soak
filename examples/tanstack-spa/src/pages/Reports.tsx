const reports = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  name: `Report ${i}`,
  total: (i * 37) % 500,
}));

export function Reports() {
  return (
    <section>
      <h1>Reports</h1>
      <p className="lede">
        A plain list with nothing wrong with it. The route-switching soak test
        flips between here and the dashboard, so mounting and unmounting a
        page&rsquo;s worth of DOM gets measured too.
      </p>
      <ul className="rows" data-testid="reports">
        {reports.map((report) => (
          <li key={report.id}>
            {report.name} — {report.total}
          </li>
        ))}
      </ul>
    </section>
  );
}
