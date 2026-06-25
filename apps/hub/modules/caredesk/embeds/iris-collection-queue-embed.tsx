/* eslint-disable */
// @ts-nocheck
"use client";

import { IrisPage } from "../IrisPage";

type IrisCollectionQueueEmbedProps = {
  queueSlugFilter?: string | null;
};

// Public Iris-owned embed consumed by Hades while the cobrança queue remains in Iris.
export function IrisCollectionQueueEmbed({
  queueSlugFilter = "cobranca",
}: IrisCollectionQueueEmbedProps) {
  return (
    <IrisPage
      boardOnly
      embedded
      queueSlugFilter={queueSlugFilter}
    />
  );
}
