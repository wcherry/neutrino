// Re-export from the shared API package so app-level imports work.
export { diagramsApi } from '@neutrino/api-diagrams';
export type {
  DiagramResponse,
  DiagramMetaResponse,
  CreateDiagramRequest,
  SaveDiagramRequest,
  ListDiagramsResponse,
  DiagramComment,
  CreateCommentRequest,
  UpdateCommentRequest,
  ListCommentsResponse,
} from '@neutrino/api-diagrams';
