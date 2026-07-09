'use client';
// Intentionally a full client component: tab switching, person-filter dropdowns,
// upload/drag-drop, and mutations are tightly coupled across the entire page.
// No meaningful static server shell exists.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Heading, Spinner, Modal, ModalHeader, ModalBody } from '@neutrino/ui';
import {
  Image as ImageIcon,
  Upload,
  Star,
  Archive,
  Trash2,
  FolderOpen,
  Plus,
  X,
  Info,
  Users,
  ChevronDown,
  Sparkles,
  Wand2,
} from 'lucide-react';
import {
  photosApi,
  albumsApi,
  personsApi,
  facesApi,
  uploadEncryptedFile,
  type PhotoResponse,
  type AlbumResponse,
  type PersonResponse,
  type MemoryYear,
} from '@/lib/api';
import { readAutoFaceDetect } from '@/hooks/usePhotoSettings';
import { generateThumbnail } from '@neutrino/api-photos';
import { useUser } from '@neutrino/auth';
import { initSodium, generateFileKey, encryptFileKey, encryptMetadata, loadKeyPair } from '@neutrino/e2e-crypto';
import { PhotoInfoPanel } from './PhotoInfoPanel';
import { PersonPhotosPanel } from './PersonPhotosPanel';
import { SuggestionsPanel, SuggestionsBadge } from './SuggestionsPanel';
import styles from './page.module.css';

type FilterTab = 'all' | 'favorites' | 'archive' | 'albums' | 'people' | 'memories';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}


function useAuthBlobUrl(path: string | null): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
    fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.blob() : Promise.reject())
      .then(blob => {
        if (!cancelled) {
          const url = URL.createObjectURL(blob);
          blobRef.current = url;
          setBlobUrl(url);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, [path]);

  return blobUrl;
}

function PhotoCard({
  photo,
  onStar,
  onArchive,
  onTrash,
  onInfo,
  onPreview,
}: {
  photo: PhotoResponse;
  onStar: (photo: PhotoResponse) => void;
  onArchive: (photo: PhotoResponse) => void;
  onTrash: (photo: PhotoResponse) => void;
  onInfo: (photo: PhotoResponse) => void;
  onPreview: (photo: PhotoResponse) => void;
}) {
  const thumbDataUrl = photo.thumbnail && photo.thumbnailMimeType
    ? `data:${photo.thumbnailMimeType};base64,${photo.thumbnail}`
    : null;
  const blobUrl = useAuthBlobUrl(thumbDataUrl ? null : (isImageMime(photo.mimeType) ? photo.contentUrl : null));
  const imgSrc = thumbDataUrl ?? blobUrl;

  return (
    <div className={styles.photoCard} onClick={() => onPreview(photo)} style={{ cursor: 'pointer' }}>
      {imgSrc ? (
        <img src={imgSrc} alt={photo.fileName} className={styles.photoImg} loading="lazy" />
      ) : (
        <div className={styles.photoPlaceholder}>
          <ImageIcon size={32} />
          <span>{photo.fileName}</span>
        </div>
      )}

      <div className={styles.photoOverlay}>
        <div className={styles.photoOverlayTop}>
          <button
            className={styles.iconBtn}
            onClick={(e) => { e.stopPropagation(); onStar(photo); }}
            title={photo.isStarred ? 'Unstar' : 'Star'}
          >
            <Star size={14} className={photo.isStarred ? styles.starredIcon : undefined} fill={photo.isStarred ? 'currentColor' : 'none'} />
          </button>
          <button
            className={styles.iconBtn}
            onClick={(e) => { e.stopPropagation(); onArchive(photo); }}
            title={photo.isArchived ? 'Unarchive' : 'Archive'}
          >
            <Archive size={14} />
          </button>
          <button
            className={styles.iconBtn}
            onClick={(e) => { e.stopPropagation(); onTrash(photo); }}
            title="Move to trash"
          >
            <Trash2 size={14} />
          </button>
          <button
            className={styles.iconBtn}
            onClick={(e) => { e.stopPropagation(); onInfo(photo); }}
            title="Photo info"
          >
            <Info size={14} />
          </button>
        </div>
        <div className={styles.photoOverlayBottom}>
          <span className={styles.photoName}>{photo.fileName}</span>
          <span className={styles.photoDate}>{formatDate(photo.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function AlbumCard({ album }: { album: AlbumResponse }) {
  return (
    <div className={styles.albumCard}>
      <div className={styles.albumCover}>
        {album.isAuto ? <Wand2 size={40} /> : <FolderOpen size={40} />}
      </div>
      <div className={styles.albumInfo}>
        <p className={styles.albumTitle}>
          {album.title}
          {album.isAuto && (
            <span style={{ marginLeft: 6, fontSize: 'var(--font-size-xs)', fontWeight: 400, color: 'var(--color-text-secondary)', background: 'var(--color-surface-raised, #f3f4f6)', borderRadius: 4, padding: '1px 5px' }}>
              Smart
            </span>
          )}
        </p>
        <p className={styles.albumCount}>{album.photoCount} {album.photoCount === 1 ? 'photo' : 'photos'}</p>
      </div>
    </div>
  );
}

function PersonCard({ person, onClick }: { person: PersonResponse; onClick: () => void }) {
  const faces = person.faces ?? [];
  return (
    <div className={styles.personCard} onClick={onClick}>
      <div className={styles.personFaceStrip}>
        {faces.length === 0 ? (
          <div className={styles.personAvatarPlaceholder}>
            <Users size={28} />
          </div>
        ) : (
          faces.slice(0, 6).map((face) => {
            const src = face.thumbnail && face.thumbnailMimeType
              ? `data:${face.thumbnailMimeType};base64,${face.thumbnail}`
              : null;
            return src ? (
              <img key={face.id} src={src} alt="" className={styles.personFaceThumb} />
            ) : (
              <div key={face.id} className={styles.personFaceThumbPlaceholder}>
                <Users size={14} />
              </div>
            );
          })
        )}
      </div>
      <p className={styles.personName}>{person.name ?? 'Unknown person'}</p>
      <p className={styles.personCount}>{person.faceCount} {person.faceCount === 1 ? 'photo' : 'photos'}</p>
    </div>
  );
}

export default function PhotosPage() {
  const queryClient = useQueryClient();
  const currentUser = useUser();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [showNewAlbum, setShowNewAlbum] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoResponse | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<PersonResponse | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [includePersonIds, setIncludePersonIds] = useState<string[]>([]);
  const [excludePersonIds, setExcludePersonIds] = useState<string[]>([]);
  const [personFilterOpen, setPersonFilterOpen] = useState(false);
  const [personFilterSearch, setPersonFilterSearch] = useState('');
  const personFilterRef = useRef<HTMLDivElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function openPreview(photo: PhotoResponse) {
    router.push(`/photos/editor?fileId=${photo.fileId}`);
  }

  const photosQuery = useQuery({
    queryKey: ['photos', activeTab, includePersonIds, excludePersonIds],
    queryFn: () => {
      if (activeTab === 'favorites') return photosApi.listPhotos({ starredOnly: true });
      if (activeTab === 'archive') return photosApi.listPhotos({ archivedOnly: true });
      if (includePersonIds.length > 0 || excludePersonIds.length > 0)
        return photosApi.listPhotos({ personIds: includePersonIds, excludePersonIds });
      return photosApi.listPhotos();
    },
    enabled: activeTab !== 'albums' && activeTab !== 'people',
  });

  const albumsQuery = useQuery({
    queryKey: ['albums'],
    queryFn: () => albumsApi.listAlbums(),
    enabled: activeTab === 'albums',
  });

  // Always fetch persons so they're available for the filter bar.
  const personsQuery = useQuery({
    queryKey: ['persons'],
    queryFn: () => personsApi.listPersons(),
  });

  const memoriesQuery = useQuery({
    queryKey: ['memories'],
    queryFn: () => photosApi.getMemories(),
    enabled: activeTab === 'memories',
  });

  // Close dropdown when clicking outside.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (personFilterRef.current && !personFilterRef.current.contains(e.target as Node)) {
        setPersonFilterOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const userId = currentUser?.id;
      if (!userId) throw new Error('You must be signed in to upload photos.');

      await initSodium();
      const kp = loadKeyPair(userId);
      if (!kp) {
        throw new Error(
          'Your encryption keys could not be found. Sign out and sign back in to restore them, then try again.',
        );
      }

      const dek = generateFileKey();
      const encryptedFileKey = encryptFileKey(dek, kp.publicKey);
      const encryptedMetadata = encryptMetadata(
        { name: file.name, mimeType: file.type || 'application/octet-stream' },
        dek,
      );
      const thumbnailB64 = file.type.startsWith('image/')
        ? await generateThumbnail(file)
        : null;
      console.log('[photos:upload] thumbnailB64 present:', thumbnailB64 !== null, 'length:', thumbnailB64?.length ?? 0);
      const fileItem = await uploadEncryptedFile(
        file, dek, encryptedFileKey, encryptedMetadata,
        (pct) => setUploadProgress(pct),
        undefined,
        thumbnailB64,
      );
      return photosApi.registerPhoto({ fileId: fileItem.id });
    },
    onSuccess: (photo) => {
      queryClient.invalidateQueries({ queryKey: ['photos'] });
      setUploadProgress(null);
      setUploadError(null);
      // If the user opted in, kick off background face detection for the new photo.
      if (photo?.id && readAutoFaceDetect()) {
        facesApi
          .detectFaces(photo.id)
          .catch((err) => console.warn('[photos] auto face-detect failed', err));
      }
    },
    onError: (err) => {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
      setUploadProgress(null);
    },
  });

  const starMutation = useMutation({
    mutationFn: (photo: PhotoResponse) =>
      photosApi.updatePhoto(photo.id, { isStarred: !photo.isStarred }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['photos'] }),
  });

  const archiveMutation = useMutation({
    mutationFn: (photo: PhotoResponse) =>
      photosApi.updatePhoto(photo.id, { isArchived: !photo.isArchived }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['photos'] }),
  });

  const trashMutation = useMutation({
    mutationFn: (photo: PhotoResponse) => photosApi.trashPhoto(photo.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['photos'] }),
  });

  const createAlbumMutation = useMutation({
    mutationFn: () => albumsApi.createAlbum({ title: newAlbumTitle.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['albums'] });
      setNewAlbumTitle('');
      setShowNewAlbum(false);
    },
  });

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((file) => uploadMutation.mutate(file));
    e.target.value = '';
    setShowUploadModal(false);
  }, [uploadMutation]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach((file) => uploadMutation.mutate(file));
    setShowUploadModal(false);
  }, [uploadMutation]);

  const photos = photosQuery.data?.photos ?? [];
  const albums = albumsQuery.data?.albums ?? [];
  const persons = personsQuery.data?.persons ?? [];
  const memories = memoriesQuery.data?.memories ?? [];
  const isLoading =
    (activeTab === 'people' ? personsQuery.isLoading : false) ||
    (activeTab === 'albums' ? albumsQuery.isLoading : false) ||
    (activeTab === 'memories' ? memoriesQuery.isLoading : false) ||
    (['all', 'favorites', 'archive'].includes(activeTab) ? photosQuery.isLoading : false);

  const activeFilterPersonIds = [...includePersonIds, ...excludePersonIds];
  const filteredPersonSuggestions = persons.filter((p) => {
    const name = p.name ?? 'Unknown person';
    return (
      !activeFilterPersonIds.includes(p.id) &&
      name.toLowerCase().includes(personFilterSearch.toLowerCase())
    );
  });

  return (
    <div className={styles.page}>
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*,video/*,.heic,.heif,.raw,.cr2,.nef,.arw,.dng"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />

      <div className={styles.header}>
        <Heading level={1} size="xl">Photos</Heading>
        <div className={styles.headerActions}>
          {uploadProgress !== null && (
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
              Uploading {uploadProgress}%
            </span>
          )}
          <div style={{ position: 'relative', display: 'inline-flex' }}>
            <Button
              variant="secondary"
              onClick={() => setShowSuggestions((v) => !v)}
              icon={<Sparkles size={16} />}
            >
              Suggestions
            </Button>
            <SuggestionsBadge />
          </div>
          <Button
            variant="secondary"
            onClick={() => setShowUploadModal(true)}
            disabled={uploadMutation.isPending}
            icon={<Upload size={16} />}
          >
            Upload
          </Button>
        </div>
      </div>

      {uploadError && (
        <div className={styles.errorBanner}>
          {uploadError}
          <button onClick={() => setUploadError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
            <X size={16} />
          </button>
        </div>
      )}

      <div className={styles.filterTabs}>
        {(['all', 'favorites', 'archive', 'albums', 'people', 'memories'] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            className={`${styles.filterTab} ${activeTab === tab ? styles.filterTabActive : ''}`}
            onClick={() => {
              setActiveTab(tab);
              if (tab !== 'all') {
                setIncludePersonIds([]);
                setExcludePersonIds([]);
                setPersonFilterOpen(false);
              }
            }}
          >
            {tab === 'all' && 'All Photos'}
            {tab === 'favorites' && 'Favorites'}
            {tab === 'archive' && 'Archive'}
            {tab === 'albums' && 'Albums'}
            {tab === 'people' && 'People'}
            {tab === 'memories' && 'Memories'}
          </button>
        ))}
      </div>

      {activeTab === 'all' && persons.length > 0 && (
        <div className={styles.filterBar}>
          <div className={styles.filterBarLeft}>
            {includePersonIds.map((pid) => {
              const p = persons.find((p) => p.id === pid);
              return (
                <span key={pid} className={styles.filterChip}>
                  <Users size={12} />
                  {p?.name ?? 'Unknown person'}
                  <button
                    className={styles.filterChipRemove}
                    onClick={() => setIncludePersonIds((ids) => ids.filter((id) => id !== pid))}
                    aria-label="Remove filter"
                    title="Remove"
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
            {excludePersonIds.map((pid) => {
              const p = persons.find((p) => p.id === pid);
              return (
                <span key={pid} className={styles.filterChip} style={{ opacity: 0.65, textDecoration: 'line-through' }} title="Excluding this person">
                  <Users size={12} />
                  {p?.name ?? 'Unknown person'}
                  <button
                    className={styles.filterChipRemove}
                    onClick={() => setExcludePersonIds((ids) => ids.filter((id) => id !== pid))}
                    aria-label="Remove exclusion filter"
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
            {(includePersonIds.length > 0 || excludePersonIds.length > 0) && (
              <button
                className={styles.clearFiltersBtn}
                onClick={() => { setIncludePersonIds([]); setExcludePersonIds([]); }}
              >
                Clear
              </button>
            )}
          </div>

          <div className={styles.personFilterDropdown} ref={personFilterRef}>
            <button
              className={styles.filterDropdownTrigger}
              onClick={() => {
                setPersonFilterOpen((v) => !v);
                setPersonFilterSearch('');
              }}
            >
              <Users size={14} />
              People
              <ChevronDown size={13} />
            </button>

            {personFilterOpen && (
              <div className={styles.filterDropdownMenu}>
                <input
                  autoFocus
                  className={styles.filterDropdownSearch}
                  placeholder="Search people..."
                  value={personFilterSearch}
                  onChange={(e) => setPersonFilterSearch(e.target.value)}
                />
                <div className={styles.filterDropdownList}>
                  {filteredPersonSuggestions.length === 0 ? (
                    <div className={styles.filterDropdownEmpty}>No matches</div>
                  ) : (
                    filteredPersonSuggestions.map((p) => {
                      const src =
                        p.coverThumbnail && p.coverThumbnailMimeType
                          ? `data:${p.coverThumbnailMimeType};base64,${p.coverThumbnail}`
                          : null;
                      return (
                        <div key={p.id} style={{ display: 'flex', gap: 0 }}>
                          <button
                            className={styles.filterDropdownItem}
                            style={{ flex: 1 }}
                            onClick={() => {
                              setIncludePersonIds((ids) => [...ids, p.id]);
                              setPersonFilterOpen(false);
                              setPersonFilterSearch('');
                            }}
                          >
                            {src ? (
                              <img src={src} alt="" className={styles.filterDropdownAvatar} />
                            ) : (
                              <div className={styles.filterDropdownAvatarPlaceholder}>
                                <Users size={12} />
                              </div>
                            )}
                            <span>{p.name ?? 'Unknown person'}</span>
                          </button>
                          <button
                            title="Exclude this person"
                            style={{ padding: '0 var(--space-2)', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' }}
                            onClick={() => {
                              setExcludePersonIds((ids) => [...ids, p.id]);
                              setPersonFilterOpen(false);
                              setPersonFilterSearch('');
                            }}
                          >
                            not
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-16)' }}>
          <Spinner size="lg" />
        </div>
      ) : activeTab === 'memories' ? (
        <div className={styles.memoriesSection}>
          {memories.length === 0 ? (
            <div className={styles.emptyState}>
              <Sparkles size={48} className={styles.emptyIcon} />
              <p>No memories yet. Photos with dates from past years will appear here.</p>
            </div>
          ) : (
            memories.map((memory: MemoryYear) => (
              <div key={memory.year} className={styles.memoriesYear}>
                <p className={styles.memoriesYearTitle}>{memory.year}</p>
                <div className={styles.memoriesPhotoRow}>
                  {memory.photos.map((p) => {
                    const thumbSrc = `/api/v1/photos/${p.id}/thumbnail`;
                    return (
                      <div key={p.id} className={styles.memoriesThumb}>
                        <img src={thumbSrc} alt="" loading="lazy" />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      ) : activeTab === 'people' ? (
        <div className={styles.peopleSection}>
          {persons.length === 0 ? (
            <div className={styles.emptyState}>
              <Users size={48} className={styles.emptyIcon} />
              <p>No people detected yet. Upload photos and face detection will group them here.</p>
            </div>
          ) : (
            <div className={styles.personGrid}>
              {persons.map((person) => (
                <PersonCard
                  key={person.id}
                  person={person}
                  onClick={() => setSelectedPerson((prev) => prev?.id === person.id ? null : person)}
                />
              ))}
            </div>
          )}
        </div>
      ) : activeTab === 'albums' ? (
        <div className={styles.albumsSection}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
            {showNewAlbum ? (
              <>
                <input
                  autoFocus
                  value={newAlbumTitle}
                  onChange={(e) => setNewAlbumTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newAlbumTitle.trim()) createAlbumMutation.mutate();
                    if (e.key === 'Escape') setShowNewAlbum(false);
                  }}
                  placeholder="Album title"
                  style={{ padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-sm)' }}
                />
                <Button
                  onClick={() => createAlbumMutation.mutate()}
                  disabled={!newAlbumTitle.trim() || createAlbumMutation.isPending}
                >
                  Create
                </Button>
                <Button variant="ghost" onClick={() => setShowNewAlbum(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button icon={<Plus size={16} />} onClick={() => setShowNewAlbum(true)}>
                New Album
              </Button>
            )}
          </div>

          {albums.length === 0 ? (
            <div className={styles.emptyState}>
              <FolderOpen size={48} className={styles.emptyIcon} />
              <p>No albums yet. Create one to organize your photos.</p>
            </div>
          ) : (
            <div className={styles.albumGrid}>
              {albums.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          )}
        </div>
      ) : photos.length === 0 ? (
        <div
          className={styles.uploadZone}
          onClick={() => uploadInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && uploadInputRef.current?.click()}
        >
          <ImageIcon size={48} className={styles.emptyIcon} />
          <p className={styles.uploadZoneText}>
            {activeTab === 'favorites'
              ? 'No starred photos yet. Star photos to see them here.'
              : activeTab === 'archive'
              ? 'No archived photos.'
              : 'Drop photos here or click to upload'}
          </p>
          {activeTab === 'all' && (
            <Button icon={<Upload size={16} />}>Upload Photos</Button>
          )}
        </div>
      ) : (
        <div className={styles.photoGrid}>
          {photos.map((photo) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              onStar={(p) => starMutation.mutate(p)}
              onArchive={(p) => archiveMutation.mutate(p)}
              onTrash={(p) => trashMutation.mutate(p)}
              onInfo={(p) => setSelectedPhoto((prev) => prev?.id === p.id ? null : p)}
              onPreview={(p) => openPreview(p)}
            />
          ))}
        </div>
      )}

      {selectedPhoto && (
        <PhotoInfoPanel
          photo={selectedPhoto}
          onClose={() => setSelectedPhoto(null)}
        />
      )}

      {selectedPerson && (
        <PersonPhotosPanel
          person={selectedPerson}
          allPersons={persons}
          onClose={() => setSelectedPerson(null)}
          onPersonUpdated={(updated) => {
            setSelectedPerson(updated);
            queryClient.invalidateQueries({ queryKey: ['persons'] });
          }}
          onPersonDeleted={() => {
            setSelectedPerson(null);
            queryClient.invalidateQueries({ queryKey: ['persons'] });
          }}
        />
      )}

      {showSuggestions && (
        <SuggestionsPanel onClose={() => setShowSuggestions(false)} />
      )}

      <Modal open={showUploadModal} onClose={() => setShowUploadModal(false)} size="md">
        <ModalHeader title="Upload files" onClose={() => setShowUploadModal(false)} />
        <ModalBody>
          <div
            className={`${styles.modalDropZone} ${isDraggingOver ? styles.modalDropZoneActive : ''}`}
            onClick={() => uploadInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && uploadInputRef.current?.click()}
          >
            <Upload size={36} className={styles.modalDropIcon} />
            <p className={styles.modalDropText}>Drag &amp; drop files here</p>
            <p className={styles.modalDropHint}>or click to browse &middot; up to 10 GB per file</p>
          </div>
        </ModalBody>
      </Modal>
    </div>
  );
}
