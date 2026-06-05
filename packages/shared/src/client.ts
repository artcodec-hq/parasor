export interface ClientPreferences {
  clientId: string;
  focusedProjectId: string | null;
  focusedPaneId: string | null;
  mobileFocusedPaneId: string | null;
  sidebarOpen: boolean;
}
