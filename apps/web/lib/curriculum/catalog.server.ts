// Server-only access to the compiled curriculum catalogue (design §7).
//
// The catalogue is imported exactly once, here. The `server-only` marker
// makes any accidental client-component import a build error, keeping the
// full catalogue (and its size) out of client JavaScript. Client components
// receive only the minimal per-lesson props they need, passed from Server
// Components.
//
// The imported artifact is the committed, drift-gated build output — the
// public view only. Answer keys live in catalog.grading.json, which is never
// imported anywhere in apps/web (CI greps the built chunks for the grading
// canary and `correct_index` to prove it).

import "server-only";
import catalog from "../../../../curriculum/build/catalog.json";

export type CatalogTopic = {
  slug: string;
  title: string;
  summary: string;
  status: "active" | "planned" | "retired";
  prerequisites: string[];
  learning_objectives: string[];
  lessons: string[];
  concepts: string[];
};

export type CheckpointQuestion = {
  id: string;
  prompt: string;
  options: string[];
  concept: string;
};

export type LessonBlock = { id: string; heading: string; markdown: string };

export type CatalogLesson = {
  slug: string;
  title: string;
  topic: string;
  version: number;
  duration_minutes: number;
  objectives: string[];
  concepts: string[];
  demos: string[];
  demo_fallbacks: Record<string, string>;
  blocks: LessonBlock[];
  checkpoint: {
    slug: string;
    kind: string;
    pass_score: number;
    questions: CheckpointQuestion[];
  };
  sources: { id: string; url: string; title?: string | null }[];
};

type Catalog = {
  source_tree_hash: string;
  curriculum: { slug: string; title: string; version: number; topics: string[] };
  topics: Record<string, CatalogTopic>;
  concepts: Record<string, { slug: string; name: string; short_definition: string }>;
  lessons: Record<string, CatalogLesson>;
};

const cat = catalog as unknown as Catalog;

export const catalogHash: string = cat.source_tree_hash;
export const curriculum = cat.curriculum;

export function orderedTopics(): CatalogTopic[] {
  return cat.curriculum.topics.map((slug) => cat.topics[slug]).filter(Boolean);
}

export function getTopic(slug: string): CatalogTopic | null {
  return cat.topics[slug] ?? null;
}

export function getLesson(slug: string): CatalogLesson | null {
  return cat.lessons[slug] ?? null;
}

export function getConceptName(slug: string): string {
  return cat.concepts[slug]?.name ?? slug;
}
