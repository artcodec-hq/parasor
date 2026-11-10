export const APP_METADATA = {
  version: import.meta.env.PARASOR_APP_VERSION,
  license: import.meta.env.PARASOR_LICENSE,
  repositoryUrl: import.meta.env.PARASOR_REPOSITORY_URL,
  issuesUrl: import.meta.env.PARASOR_ISSUES_URL,
} as const;

export const APP_VERSION = APP_METADATA.version;
