// Re-export from the shared API package so app-level imports work.
export { diagramsApi, diagramsAI, DIAGRAM_MIME_TYPE } from '@neutrino/api-diagrams';
export type {
  GeneratedShape,
  GeneratedConnector,
  GenerateDiagramResponse,
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
