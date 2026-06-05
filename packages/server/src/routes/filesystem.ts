import { Hono } from "hono";
import {
  FileAccessError,
  FileExistsError,
  FileNotFoundError,
  FileReadError,
  FileWriteError,
  UnsupportedPlatformError,
} from "../application/files/errors.js";
import {
  createLocalFilesystem,
  InvalidDirectoryNameError,
} from "../application/files/local-filesystem.js";

type LocalFilesystemRouteService = ReturnType<typeof createLocalFilesystem>;

export function createFilesystemRoutes(
  localFilesystem: LocalFilesystemRouteService = createLocalFilesystem(),
): Hono {
  const routes = new Hono();

  routes.get("/browse", (c) => {
    try {
      return c.json(localFilesystem.browseDirectories(c.req.query("path")));
    } catch (error) {
      if (error instanceof FileAccessError) {
        return c.json({ error: error.message }, 403);
      }
      if (error instanceof FileReadError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  routes.post("/pick-folder", async (c) => {
    try {
      const folderPath = await localFilesystem.pickProjectFolder();
      if (!folderPath) return c.json({ cancelled: true });
      return c.json({ path: folderPath });
    } catch (error) {
      if (error instanceof UnsupportedPlatformError) {
        return c.json({ error: error.message }, 400);
      }
      throw error;
    }
  });

  routes.post("/mkdir", async (c) => {
    let body: { parent?: unknown; name?: unknown };
    try {
      body = await c.req.json<{ parent?: unknown; name?: unknown }>();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
    if (typeof body.parent !== "string" || !body.parent) {
      return c.json({ error: "parent is required" }, 400);
    }
    if (typeof body.name !== "string") {
      return c.json({ error: "name is required" }, 400);
    }
    try {
      const result = localFilesystem.createProjectDirectory({
        parent: body.parent,
        name: body.name,
      });
      return c.json(result, 201);
    } catch (error) {
      if (error instanceof InvalidDirectoryNameError) {
        return c.json({ error: error.message }, 400);
      }
      if (error instanceof FileNotFoundError) {
        return c.json({ error: error.message }, 404);
      }
      if (error instanceof FileExistsError) {
        return c.json({ error: error.message }, 409);
      }
      if (error instanceof FileAccessError) {
        return c.json({ error: error.message }, 403);
      }
      if (error instanceof FileWriteError) {
        return c.json({ error: error.message }, 500);
      }
      throw error;
    }
  });

  return routes;
}
