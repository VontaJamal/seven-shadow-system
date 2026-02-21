export interface BitbucketServerStub {
  name: "bitbucket-server";
  runtimeEnabled: false;
  status: "planned";
  notes: string[];
  plannedEvents: string[];
}

export const bitbucketServerStub: BitbucketServerStub = {
  name: "bitbucket-server",
  runtimeEnabled: false,
  status: "planned",
  notes: [
    "Bitbucket Server/Data Center adapter is intentionally not wired into runtime provider registry in this cycle.",
    "Use Bitbucket Cloud provider ('bitbucket') for supported runtime integration."
  ],
  plannedEvents: ["pr:opened", "pr:modified", "pr:comment:added", "pr:comment:edited"]
};
