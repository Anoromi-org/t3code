import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createConnection, ORCHESTRATION_WS_METHODS, type Client } from "../src/index.ts";
import { T3Connect, useT3Connection } from "../src/react.tsx";
import "../src/style.css";

const connection = createConnection();
function Projects({ client }: { client: Client }) {
  const rpc = client.rpc;
  const [projects, setProjects] = useState<ReadonlyArray<{ id: string; title: string }>>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const item of rpc[ORCHESTRATION_WS_METHODS.subscribeShell](
          {},
          { signal: controller.signal },
        )) {
          if (item.kind === "snapshot") setProjects(item.snapshot.projects);
          if (item.kind === "project-upserted")
            setProjects((current) => [
              ...current.filter((project) => project.id !== item.project.id),
              item.project,
            ]);
          if (item.kind === "project-removed")
            setProjects((current) => current.filter((project) => project.id !== item.projectId));
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      }
    })();
    return () => controller.abort();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The async stream must restart when the RPC client changes.
  }, [rpc]);
  return (
    <section aria-label="Projects">
      <h2>Projects</h2>
      {projects.length ? (
        <ul>
          {projects.map((project) => (
            <li key={project.id}>{project.title}</li>
          ))}
        </ul>
      ) : (
        <p>No projects yet.</p>
      )}
      {error && <p role="alert">Could not load projects.</p>}
    </section>
  );
}
function App() {
  const state = useT3Connection(connection);
  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <T3Connect connection={connection} />
      {state.status === "connected" && <Projects client={state.client} />}
    </div>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
window.addEventListener("pagehide", () => {
  void connection.disconnect();
});
