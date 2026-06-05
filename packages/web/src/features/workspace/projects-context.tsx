import type { Project } from "@parasor/shared";
import { createContext, type ReactNode, useContext } from "react";

const ProjectsContext = createContext<Project[]>([]);

export function ProjectsProvider({
  projects,
  children,
}: {
  projects: Project[];
  children: ReactNode;
}) {
  return (
    <ProjectsContext.Provider value={projects}>
      {children}
    </ProjectsContext.Provider>
  );
}

export function useProject(
  projectId: string | null | undefined,
): Project | undefined {
  const projects = useContext(ProjectsContext);
  if (!projectId) return undefined;
  return projects.find((p) => p.id === projectId);
}
