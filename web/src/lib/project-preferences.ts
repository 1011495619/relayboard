export interface ProjectPreferences {
  favorites: string[];
  recent: string[];
  hidden: string[];
}

const ids = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          ),
        ),
      ]
    : [];

// Preferences are local UI state. Treat old or malformed storage as empty;
// project records, task ownership and server state are never changed here.
export function readProjectPreferences(raw: string | null): ProjectPreferences {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    const input =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    return {
      favorites: ids(input.favorites),
      recent: ids(input.recent).slice(0, 5),
      hidden: ids(input.hidden),
    };
  } catch {
    return { favorites: [], recent: [], hidden: [] };
  }
}

export function visitProject(
  preferences: ProjectPreferences,
  id: string,
): ProjectPreferences {
  if (!id || (preferences.recent[0] === id && !preferences.hidden.includes(id)))
    return preferences;
  return {
    ...preferences,
    recent: [id, ...preferences.recent.filter((item) => item !== id)].slice(
      0,
      5,
    ),
    hidden: preferences.hidden.filter((item) => item !== id),
  };
}

export function toggleProjectPreference(
  preferences: ProjectPreferences,
  key: "favorites" | "hidden",
  id: string,
): ProjectPreferences {
  return {
    ...preferences,
    [key]: preferences[key].includes(id)
      ? preferences[key].filter((item) => item !== id)
      : [...preferences[key], id],
  };
}
