export type RemoteDesignSystemComponentRef = {
  name: string;
  key: string;
  fileKey?: string;
  sourceUrl?: string;
};

export type RemoteDesignSystemSearchResult =
  | {
      status: "ready";
      source: "figma-remote";
      results: RemoteDesignSystemComponentRef[];
    }
  | {
      status: "not-configured";
      source: "figma-remote";
      results: [];
      setupAction: {
        message: string;
        hint: string;
      };
    };

export type FigmaRemoteDesignSystemSearch = {
  searchComponents(
    query: string,
    options?: { limit?: number }
  ): Promise<RemoteDesignSystemSearchResult>;
};

export function createNotConfiguredFigmaRemoteSearch(): FigmaRemoteDesignSystemSearch {
  return {
    async searchComponents() {
      return {
        status: "not-configured",
        source: "figma-remote",
        results: [],
        setupAction: {
          message: "Figma remote design-system search is not configured.",
          hint: "Kotikit uses the local design-system cache first. Configure a remote MCP adapter only as a fallback.",
        },
      };
    },
  };
}
