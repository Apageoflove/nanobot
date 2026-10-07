import { FullAccessIcon, WorkspaceIcon, RestrictedAccessIcon } from "@/components/icons/product-icons";
import * as Menu from "@radix-ui/react-menu";
import { useFloatingPortal } from "@/components/ui/floating-portal";
import type { ReactElement } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, FolderOpen, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToggleButton } from "@/components/settings/ToggleButton";
import { Button } from "@/components/ui/button";
import { floatingItemClassName, floatingItemFocusClassName, floatingSurfaceClassName, floatingSurfaceMotionClassName } from "@/components/ui/floating-surface";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { WorkspaceScopePayload, ProjectDirectory, WorkspaceDirectoriesPayload, WorkspacesPayload } from "@/lib/types";
import { createWorkspaceDirectoryCache } from "@/lib/workspace-directory-cache";
import { getRuntimeHost } from "@/lib/runtime";
import { cn } from "@/lib/utils";
import { isAbsoluteWorkspacePath, projectNameFromPath, sameWorkspacePath, scopeWithAccessMode, workspacePathCompletionQuery, workspaceDirectoryPrefix, selectedProjectScope, type BrowseWorkspaceDirectories } from "@/lib/workspace";

function WorkspaceFolderMenu({ path, pinned, busy, onToggle, onRequestFocus, children }: {
  path: string; pinned: boolean; busy: boolean;
  onToggle: () => void; onRequestFocus: () => void; children: ReactElement;
}) {
  const { t } = useTranslation();
  const portal = useFloatingPortal();
  const [open, setOpen] = useState(false);
  const point = useRef({ x: 0, y: 0 });
  const anchor = useRef({ getBoundingClientRect: () => new DOMRect(point.current.x, point.current.y, 0, 0) });
  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Anchor virtualRef={anchor} />
      <div className="contents" onContextMenu={event => {
        event.preventDefault(); event.stopPropagation();
        point.current = { x: event.clientX, y: event.clientY }; setOpen(true);
      }} onKeyDown={event => {
        if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
        event.preventDefault(); event.stopPropagation();
        const bounds = (event.target as HTMLElement).getBoundingClientRect();
        point.current = { x: bounds.left, y: bounds.bottom }; setOpen(true);
      }}>{children}</div>
      <Menu.Portal container={portal ?? undefined}>
        <Menu.Content align="start" sideOffset={4} collisionPadding={12}
          className={cn(floatingSurfaceClassName, floatingSurfaceMotionClassName, "min-w-40 rounded-control p-1")}
          onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}
          onCloseAutoFocus={event => { event.preventDefault(); onRequestFocus(); }}>
          <Menu.Item disabled={busy} onSelect={onToggle}
            className={cn(floatingItemClassName, floatingItemFocusClassName, "cursor-default data-[disabled]:pointer-events-none data-[disabled]:opacity-50")}>
            {t(pinned ? "workspace.picker.unpin" : "workspace.picker.pin", { name: projectNameFromPath(path) })}
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

type PickerOption = ProjectDirectory & { kind: "directory" | "manual"; group: string };
type PickerColumn = { path: string; options: PickerOption[]; selectedPath: string | null; hidden: boolean };

function WorkspacePickerTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-[min(28rem,calc(100vw-2rem))] whitespace-pre-line break-all">{label}</TooltipContent>
    </Tooltip>
  );
}

function WorkspaceDirectorySkeleton() {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(1);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setRows(Math.max(1, Math.ceil(viewport.clientHeight / 44)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  const widths = ["64%", "78%", "52%", "70%", "60%", "74%"];
  return (
    <div ref={viewportRef} role="status" aria-label={t("workspace.picker.loading")} className="workspace-directory-loading h-full">
      <span className="sr-only">{t("workspace.picker.loading")}</span>
      <div aria-hidden="true">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex h-11 items-center px-3 py-2">
            <span className="h-3.5 rounded-control bg-foreground/[0.055]" style={{ width: widths[index % widths.length] }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkspacePickerPath({ path }: { path: string }) {
  const parts = workspacePathCompletionQuery(path);
  return (
    <WorkspacePickerTooltip label={path}>
      <span className="flex min-w-0 flex-1 text-[13px]">
        <span className="min-w-0 truncate">{parts?.path ?? path}</span>
        {parts?.query && <span className="max-w-[65%] shrink-0 truncate">{parts.query}</span>}
      </span>
    </WorkspacePickerTooltip>
  );
}

export function WorkspaceProjectPicker({ isHero, connected = false, disabled, scope, defaultScope, controls, error, onPickFolder, onLoadProjects, onResolveProject, onFavoriteProject, onBrowseDirectories, layoutAnchor, onChange }: {
  layoutAnchor?: HTMLElement | null;
  isHero: boolean;
  connected?: boolean;
  disabled?: boolean;
  scope: WorkspaceScopePayload | null;
  defaultScope: WorkspaceScopePayload | null;
  controls: WorkspacesPayload["controls"] | null;
  error?: string | null;
  onPickFolder?: () => Promise<string | null>;
  onResolveProject?: (path: string) => Promise<ProjectDirectory>;
  onLoadProjects?: () => Promise<WorkspacesPayload>;
  onFavoriteProject?: (path: string, pinned: boolean) => Promise<ProjectDirectory[]>;
  onBrowseDirectories?: BrowseWorkspaceDirectories;
  onChange?: (scope: WorkspaceScopePayload) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const [basePath, setBasePath] = useState(scope?.project_path ?? defaultScope?.project_path ?? "");
  const [catalog, setCatalog] = useState<WorkspacesPayload | null>(null);
  const [directory, setDirectory] = useState<WorkspaceDirectoriesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [revision, setRevision] = useState(0);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [pathError, setPathError] = useState<string | null>(null);
  const [pickingFolder, setPickingFolder] = useState(false);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeColumn, setActiveColumn] = useState(0);
  const [highlightActive, setHighlightActive] = useState(false);
  const [previousColumns, setPreviousColumns] = useState<PickerColumn[]>([]);
  const columnsRef = useRef<HTMLDivElement | null>(null);
  const [columnsElement, setColumnsElement] = useState<HTMLDivElement | null>(null);
  const attachColumns = useCallback((element: HTMLDivElement | null) => {
    columnsRef.current = element;
    setColumnsElement(element);
  }, []);
  const [columnCapacity, setColumnCapacity] = useState(3);
  const visibleColumns = columnCapacity;
  const pickerSession = useRef(0);
  const completionRequest = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const keyboardInteraction = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionsId = useId();
  const errorId = useId();
  const currentProjectScope = selectedProjectScope(scope, defaultScope);
  const displayedScope = scope ?? defaultScope;
  const projectLabel = displayedScope?.project_name || (displayedScope ? projectNameFromPath(displayedScope.project_path) : t("thread.composer.workspace.projectPlaceholder"));
  const visible = isHero && !!defaultScope && !!onChange && controls?.can_change_project !== false;
  const canBrowse = !!controls?.can_browse_directories && !!onBrowseDirectories;
  const directoryCache = useMemo(() => onBrowseDirectories ? createWorkspaceDirectoryCache(onBrowseDirectories) : null, [onBrowseDirectories, connected]);
  const pickFolder = controls?.can_pick_folder ? getRuntimeHost().pickFolder ?? onPickFolder : undefined;
  const absoluteDraft = isAbsoluteWorkspacePath(pathDraft);
  const requestedPath = absoluteDraft ? pathDraft.trim() : basePath;
  const folderQuery = absoluteDraft ? "" : pathDraft.trim();

  useEffect(() => {
    pickerSession.current += 1;
    completionRequest.current += 1;
    if (!open) return;
    setPreviousColumns([]);
    setActiveColumn(0);
    setHighlightActive(false);
    const initialPath = scope?.project_path ?? defaultScope?.project_path ?? "";
    setPathDraft(canBrowse ? workspaceDirectoryPrefix(initialPath) : currentProjectScope?.project_path ?? "");
    setBasePath(initialPath);
    setDirectory(null);
    setActiveIndex(0);
    setPathError(null);
  }, [scope?.project_path, defaultScope?.project_path, open, canBrowse]);

  useEffect(() => {
    if (!open || !onLoadProjects) return;
    let active = true;
    setCatalog(null);
    onLoadProjects().then(payload => { if (active) setCatalog(payload); }).catch((err: Error) => { if (active) setPathError(err.message); });
    return () => { active = false; };
  }, [onLoadProjects, open]);

  useEffect(() => {
    if (!open || !canBrowse || !directoryCache) return;
    let active = true;
    const apply = (result: WorkspaceDirectoriesPayload) => {
      if (!active) return;
      setDirectory(result); setLoading(false);
      if (absoluteDraft) setBasePath(result.path);
    };
    setDirectoryError(null);
    const cached = directoryCache.peek(requestedPath, folderQuery, showHidden, true);
    if (cached) { apply(cached); return; }
    setLoading(true);
    setDirectory(null);
    const typing = !!folderQuery || absoluteDraft && !/[\\/]$/.test(pathDraft);
    const timer = window.setTimeout(() => {
      directoryCache.load(requestedPath, folderQuery, showHidden, true).then(apply).catch((err: Error) => {
        if (active) { setDirectoryError(err.message); setLoading(false); }
      });
    }, typing ? 150 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, canBrowse, directoryCache, requestedPath, folderQuery, showHidden, revision, absoluteDraft, pathDraft]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!error || !visible || disabled) return;
    const frame = window.requestAnimationFrame(() => triggerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [disabled, error, visible]);
  useEffect(() => {
    if (!open || pickingFolder) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, pickingFolder, pathError]);

  const ancestorPaths = JSON.stringify(previousColumns.filter(column => column.hidden !== showHidden).map(column => column.path));
  const directoryGroup = t("workspace.picker.directories");
  useEffect(() => {
    if (!open || !canBrowse || !directoryCache) return;
    const paths: string[] = JSON.parse(ancestorPaths);
    if (!paths.length) return;
    let active = true;
    Promise.all(paths.map(path => directoryCache.load(path, "", showHidden, true))).then(results => {
      if (!active) return;
      setPreviousColumns(columns => columns.map(column => {
        const result = results.find(result => sameWorkspacePath(column.path, result.path));
        if (!result || !sameWorkspacePath(column.path, result.path)) return column;
        return { ...column, hidden: showHidden, options: result.entries.map(entry => ({ ...entry, kind: "directory" as const, group: directoryGroup })) };
      }));
    }).catch((err: Error) => { if (active) setPathError(err.message); });
    return () => { active = false; };
  }, [open, canBrowse, directoryCache, ancestorPaths, showHidden, directoryGroup]);

  useLayoutEffect(() => {
    const viewport = columnsElement;
    if (!open || !viewport) return;
    const measure = () => setColumnCapacity(Math.max(1, Math.min(3, Math.floor(viewport.clientWidth / 240))));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [open, columnsElement]);

  useEffect(() => {
    const viewport = columnsElement;
    if (!open || !viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.shiftKey || event.ctrlKey || event.metaKey || viewport.scrollWidth <= viewport.clientWidth) return;
      const delta = event.deltaX || event.deltaY;
      if (!delta) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
      viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, viewport.scrollLeft + delta * unit));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [open, columnsElement]);

  useLayoutEffect(() => {
    const viewport = columnsRef.current;
    if (viewport) viewport.scrollLeft = viewport.clientWidth * Math.max(0, previousColumns.length + 1 - visibleColumns) / visibleColumns;
  }, [previousColumns.length, visibleColumns]);

  function changeDraft(value: string, resetColumns = true) {
    setHighlightActive(false);
    if (resetColumns) { setPreviousColumns([]); setActiveColumn(0); }
    completionRequest.current += 1;
    setPathDraft(value);
    const absolute = isAbsoluteWorkspacePath(value);
    const cached = directoryCache?.peek(absolute ? value.trim() : basePath, absolute ? "" : value.trim(), showHidden, true);
    setDirectory(cached ?? null);
    setLoading(canBrowse && !cached);
    setDirectoryError(null);
    setPathError(null);
    setActiveIndex(0);
  }
  function navigate(path: string, columnIndex = activeColumn) {
    const source = columns[columnIndex];
    const ancestors = columns.slice(0, columnIndex);
    if (source?.options.length) ancestors.push({ ...source, selectedPath: path });
    setPreviousColumns(ancestors);
    setActiveColumn(ancestors.length);
    setBasePath(path);
    changeDraft(workspaceDirectoryPrefix(path), false);
    setRevision(value => value + 1);
    inputRef.current?.focus();
  }

  const applyProjectPath = useCallback((path: string, name?: string) => {
    const base = scope ?? defaultScope;
    const trimmed = path.trim();
    if (!base || !onChange) return;
    if (!trimmed || !isAbsoluteWorkspacePath(trimmed)) { setPathError(t("workspace.dialog.absolutePathRequired")); return; }
    const accessMode = controls?.can_use_full_access === false && !sameWorkspacePath(trimmed, base.project_path) ? "restricted" : base.access_mode;
    onChange({ ...base, project_path: trimmed, project_name: name || projectNameFromPath(trimmed), access_mode: accessMode, restrict_to_workspace: accessMode === "restricted" });
    setPathError(null);
    setOpen(false);
  }, [controls?.can_use_full_access, defaultScope, onChange, scope, t]);

  const chooseProject = useCallback(async (path: string, name?: string) => {
    const session = pickerSession.current;
    if (!controls?.can_resolve_project || !onResolveProject) { applyProjectPath(path, name); return; }
    setPickingFolder(true); setPathError(null);
    try {
      const project = await onResolveProject(path);
      if (session === pickerSession.current) applyProjectPath(project.path, project.name);
    } catch (err) {
      if (session === pickerSession.current) setPathError((err as Error).message);
    } finally { setPickingFolder(false); }
  }, [applyProjectPath, controls?.can_resolve_project, onResolveProject]);

  const pickNativeFolder = async () => {
    if (!pickFolder || disabled) return;
    const session = pickerSession.current;
    setPickingFolder(true);
    try {
      const path = await pickFolder();
      if (path && session === pickerSession.current) await chooseProject(path);
    } catch (err) {
      if (session === pickerSession.current) setPathError((err as Error).message);
    } finally { setPickingFolder(false); }
  };

  const favorites = catalog?.favorite_projects ?? [];
  const canFavorite = !!catalog?.controls.can_manage_favorites && !!onFavoriteProject;
  const isFavorite = (path: string) => favorites.some(item => sameWorkspacePath(item.path, path));
  function folderMenu(path: string, children: ReactElement, enabled = true) {
    return canFavorite && enabled ? <WorkspaceFolderMenu path={path} pinned={isFavorite(path)} busy={favoriteBusy || pickingFolder}
      onToggle={() => void toggleFavorite(path)} onRequestFocus={() => inputRef.current?.focus()}>{children}</WorkspaceFolderMenu> : children;
  }

  const toggleFavorite = async (path: string) => {
    if (!onFavoriteProject || favoriteBusy) return;
    const session = pickerSession.current;
    setFavoriteBusy(true); setPathError(null);
    try {
      const favorites = await onFavoriteProject(path, !isFavorite(path));
      if (session === pickerSession.current) setCatalog(current => current ? { ...current, favorite_projects: favorites } : current);
    } catch (err) {
      if (session === pickerSession.current) setPathError((err as Error).message);
    } finally { setFavoriteBusy(false); }
  };

  const recentProjects = [
    ...(catalog?.recent_projects ?? []),
    ...(defaultScope ? [{ name: t("workspace.dialog.defaultProject"), path: defaultScope.project_path }] : []),
    ...(currentProjectScope ? [{ name: projectLabel, path: currentProjectScope.project_path }] : []),
  ].filter((project, index, all) => all.findIndex(item => sameWorkspacePath(item.path, project.path)) === index && !isFavorite(project.path));
  const options: PickerOption[] = directory && !loading
    ? directory.entries.map(entry => ({ ...entry, kind: "directory", group: directoryGroup })) : [];
  if (!canBrowse && absoluteDraft) options.push({ name: t("workspace.dialog.usePath"), path: pathDraft.trim(), kind: "manual", group: directoryGroup });
  function openShortcut(project: ProjectDirectory) {
    if (!canBrowse) { void chooseProject(project.path, project.name); return; }
    setBasePath(project.path);
    changeDraft(workspaceDirectoryPrefix(project.path));
    setRevision(value => value + 1);
    inputRef.current?.focus();
  }
  const columns: PickerColumn[] = [...previousColumns, { path: directory?.path ?? requestedPath, options, selectedPath: null, hidden: showHidden }];
  const activeOptions = columns[activeColumn]?.options ?? options;
  const activeOption = Math.min(activeIndex, Math.max(activeOptions.length - 1, 0));
  const selectionPath = canBrowse ? (!loading && directory && !directory.partial ? directory.path : null) : (absoluteDraft ? pathDraft.trim() : scope?.project_path ?? defaultScope?.project_path);
  const displayedError = pathError ?? error ?? directoryError;

  async function completePath() {
    const option = activeOptions[activeOption];
    if (option && option.kind !== "manual") { navigate(option.path); return; }
    if (!directoryCache || !canBrowse) return;
    const request = workspacePathCompletionQuery(pathDraft) ?? { path: basePath, query: pathDraft.trim() };
    const id = ++completionRequest.current;
    const session = pickerSession.current;
    try {
      const result = await directoryCache.load(request.path, request.query, showHidden || request.query.startsWith("."));
      if (id !== completionRequest.current || session !== pickerSession.current) return;
      const first = result.entries.find(entry => entry.name.toLocaleLowerCase().startsWith(request.query.toLocaleLowerCase()));
      if (first) navigate(first.path);
    } catch (err) {
      if (id === completionRequest.current && session === pickerSession.current) setPathError((err as Error).message);
    }
  }
  function activate(option: PickerOption, columnIndex = activeColumn) {
    if (pickingFolder) return;
    if (canBrowse && option.kind !== "manual") navigate(option.path, columnIndex);
    else void chooseProject(option.path, option.kind === "manual" ? undefined : option.name);
  }

  if (!visible || !defaultScope || !onChange) return null;
  return (
    <div className="inline-flex min-w-0 max-w-[11rem] shrink items-center">
      <TooltipProvider>
      <Dialog open={open} onOpenChange={setOpen}>
        <WorkspacePickerTooltip label={`${t("workspace.picker.switchDirectory")}\n${displayedScope?.project_path ?? ""}`}>
          <DialogTrigger asChild>
            <button ref={triggerRef} onPointerDown={() => { keyboardInteraction.current = false; }} onKeyDown={() => { keyboardInteraction.current = true; }} type="button" disabled={disabled} aria-label={t("workspace.picker.switchDirectory")} className="thread-composer-workspace touch-target inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-control px-2 text-[12px] font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.055] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-55">
              <WorkspaceIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">{projectLabel}</span>
            </button>
          </DialogTrigger>
        </WorkspacePickerTooltip>
        <DialogContent showCloseButton={false} layoutAnchor={layoutAnchor} centerInLayoutAnchor className="flex h-[min(34rem,calc(100%-2rem))] max-w-5xl flex-col gap-2 p-3" onOpenAutoFocus={event => { event.preventDefault(); inputRef.current?.focus(); }} onPointerDownCapture={() => { keyboardInteraction.current = false; }} onKeyDownCapture={() => { keyboardInteraction.current = true; }} onCloseAutoFocus={event => { if (!keyboardInteraction.current) event.preventDefault(); }}>
          <DialogTitle className="sr-only">{t("thread.composer.workspace.projectAria")}</DialogTitle>
          <DialogDescription className="sr-only">{t("workspace.picker.description")}</DialogDescription>
          <div className="relative flex shrink-0 items-center border-b border-border/50 px-2 pb-2">
            <span className="pointer-events-none absolute left-2 top-0 flex h-10 w-9 items-center justify-center"><Search className="h-4 w-4 text-muted-foreground" /></span>
            <Input ref={inputRef} role="combobox" aria-expanded={open} aria-controls={`${optionsId}-${activeColumn}`} aria-activedescendant={activeOptions.length ? `${optionsId}-${activeColumn}-${activeOption}` : undefined} aria-autocomplete="list" aria-busy={loading} value={pathDraft} disabled={disabled || pickingFolder} onChange={event => changeDraft(event.target.value)} placeholder={t("workspace.picker.search")} aria-label={t("workspace.dialog.manual")} aria-invalid={displayedError || directoryError ? true : undefined} aria-describedby={displayedError || directoryError ? errorId : undefined} className="h-10 min-w-0 flex-1 border-0 bg-transparent pl-10 pr-3 text-[14px] shadow-none focus-visible:ring-0" onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.altKey && activeOptions.length) {
                event.preventDefault();
                const next = (activeOption + (event.key === "ArrowDown" ? 1 : -1) + activeOptions.length) % activeOptions.length;
                setHighlightActive(true); setActiveIndex(next); document.getElementById(`${optionsId}-${activeColumn}-${next}`)?.scrollIntoView({ block: "nearest" });
              } else if (event.key === "ArrowLeft" && activeColumn > 0 && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) {
                event.preventDefault();
                const parent = columns[activeColumn - 1];
                setHighlightActive(true);
                setActiveColumn(activeColumn - 1);
                setActiveIndex(Math.max(0, parent.options.findIndex(option => sameWorkspacePath(option.path, parent.selectedPath))));
              } else if ((event.key === "Tab" && !event.shiftKey && !!pathDraft.trim() || event.key === "ArrowRight" && !event.shiftKey && event.currentTarget.selectionStart === pathDraft.length && event.currentTarget.selectionEnd === pathDraft.length) && canBrowse) {
                event.preventDefault(); void completePath();
              } else if (event.key === "Enter") {
                event.preventDefault();
                if ((event.ctrlKey || event.metaKey) && selectionPath) void chooseProject(selectionPath);
                else if (activeOptions[activeOption]) activate(activeOptions[activeOption]);
                else if (selectionPath) void chooseProject(selectionPath);
              }
            }} />
              <Button size="sm" className="ml-2 shrink-0" disabled={!selectionPath || pickingFolder} onClick={() => selectionPath && void chooseProject(selectionPath)}>{t("workspace.picker.select")}</Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 sm:flex-row sm:gap-0">
            <nav aria-label={t("workspace.picker.shortcuts")} className="flex h-28 shrink-0 gap-2 overflow-auto border-b border-border/50 pb-2 sm:h-auto sm:w-48 sm:flex-col sm:gap-4 sm:border-b-0 sm:border-r sm:pr-2 sm:pb-0">
              {[{ label: t("workspace.picker.favorites"), projects: favorites, favorite: true }, { label: t("workspace.picker.recent"), projects: recentProjects, favorite: false }].map(section => (
                <section key={section.label} className="min-w-0 shrink-0 w-48 sm:w-auto">
                  <h3 className="px-3 py-2 text-[11px] font-medium text-muted-foreground">{section.label}</h3>
                  {section.projects.map(project => <div key={project.path}>{folderMenu(project.path,
                    <button type="button" aria-label={project.path} aria-current={sameWorkspacePath(basePath, project.path) ? "location" : undefined}
                      disabled={pickingFolder} onMouseDown={event => event.preventDefault()} onClick={() => openShortcut(project)}
                      className={cn(floatingItemClassName, floatingItemFocusClassName, "flex min-h-11 w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-foreground/[0.055] dark:hover:bg-white/[0.08]", sameWorkspacePath(basePath, project.path) && "bg-primary/10 text-primary")}>
                      <WorkspacePickerPath path={project.path} />
                      {sameWorkspacePath(project.path, scope?.project_path ?? defaultScope.project_path) && <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    </button>)}</div>)}
                  {section.favorite && !favorites.length && canFavorite && <p className="px-3 text-[11px] leading-relaxed text-muted-foreground">{t("workspace.picker.favoriteHint")}</p>}
                </section>
              ))}
            </nav>
            <div ref={attachColumns} data-workspace-columns className="flex flex-1 min-h-0 min-w-0 overflow-x-auto overscroll-x-contain">
              {columns.map((column, columnIndex) => <div key={columnIndex} className="contents">{folderMenu(column.path, <div id={`${optionsId}-${columnIndex}`} role="listbox" aria-label={column.path || t("thread.composer.workspace.projectAria")} aria-busy={columnIndex === previousColumns.length && loading} style={{ width: `${100 / visibleColumns}%` }} className={cn("min-w-0 shrink-0 overflow-x-hidden overflow-y-auto border-r border-transparent px-1 py-1", !!columns[columnIndex + 1]?.options.length && "border-border/50")}>
              {column.options.map((option, index) => <div key={`${option.kind}-${option.path}`} role="presentation">
                  {folderMenu(option.path, <button id={`${optionsId}-${columnIndex}-${index}`} type="button" role="option" aria-label={option.path} aria-selected={sameWorkspacePath(column.selectedPath, option.path)} disabled={pickingFolder}
                    onPointerMove={() => { setHighlightActive(false); setActiveColumn(columnIndex); setActiveIndex(index); }}
                    onMouseDown={event => event.preventDefault()} onClick={() => activate(option, columnIndex)}
                    className={cn(floatingItemClassName, floatingItemFocusClassName, "flex min-h-11 w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-foreground/[0.055] dark:hover:bg-white/[0.08] disabled:opacity-50",
                      sameWorkspacePath(column.selectedPath, option.path) && "bg-primary/10 text-primary font-medium hover:bg-primary/10",
                      highlightActive && columnIndex === activeColumn && index === activeOption && "ring-1 ring-inset ring-ring")}>
                    {option.kind === "directory" ? <WorkspacePickerTooltip label={option.path}><span className="min-w-0 flex-1 truncate text-[13px]">{option.name}</span></WorkspacePickerTooltip> : <WorkspacePickerPath path={option.path} />}
                    {sameWorkspacePath(option.path, scope?.project_path ?? defaultScope.project_path) && <Check className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  </button>)}
              </div>)}
              {columnIndex === previousColumns.length && loading && <WorkspaceDirectorySkeleton />}
              {columnIndex === previousColumns.length && directory?.truncated && <p className="px-3 py-2 text-[11px] text-muted-foreground">{t("workspace.picker.truncated")}</p>}
              {columnIndex === previousColumns.length && displayedError && <p id={errorId} role="alert" className="px-3 py-2 text-[11.5px] text-destructive">{displayedError}</p>}
              </div>, columnIndex !== previousColumns.length || !!selectionPath)}</div>)}
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-between gap-2 px-2 pt-1">
            <div className="flex min-w-0 items-center gap-1">
              {canBrowse && <label className="flex items-center gap-2 text-[12px] text-muted-foreground"><ToggleButton checked={showHidden} onChange={setShowHidden} label={t("workspace.picker.hidden")} />{t("workspace.picker.hidden")}</label>}
              {pickFolder && <WorkspacePickerTooltip label={t("workspace.picker.native")}><Button type="button" variant="ghost" size="icon" aria-label={t("workspace.picker.native")} disabled={pickingFolder} onClick={() => void pickNativeFolder()}><FolderOpen className="h-4 w-4" /></Button></WorkspacePickerTooltip>}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </TooltipProvider>
      {error && !open && <span role="alert" className="ml-2 min-w-0 truncate text-[11.5px] font-medium text-destructive">{error}</span>}
    </div>
  );
}

export function WorkspaceAccessToggle({
  scope,
  disabled,
  canUseFullAccess,
  isHero,
  onChange,
}: {
  scope: WorkspaceScopePayload;
  disabled?: boolean;
  canUseFullAccess: boolean;
  isHero: boolean;
  onChange?: (scope: WorkspaceScopePayload) => void;
}) {
  const { t } = useTranslation();
  const mode = scope.access_mode;
  const isFull = mode === "full";
  const accessLabel = t(
    isFull ? "thread.composer.workspace.full" : "thread.composer.workspace.default",
  );
  const shortAccessLabel = t(
    isFull ? "thread.composer.workspace.fullShort" : "thread.composer.workspace.defaultShort",
  );
  const accessAriaLabel = `${t("thread.composer.workspace.accessAria")}: ${accessLabel}`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={null}
            aria-label={accessAriaLabel}
            aria-pressed={isFull}
            disabled={disabled || !onChange || (!isFull && !canUseFullAccess)}
            onClick={() => onChange?.(scopeWithAccessMode(scope, isFull ? "restricted" : "full"))}
            className={cn(
              "settings-hover thread-composer-access touch-target min-w-0 max-w-[min(12.5rem,42vw)] whitespace-nowrap rounded-control border border-transparent font-semibold shadow-none",
              isHero ? "h-8 px-2.5 text-[12px]" : "h-9 px-3 text-[12.5px]",
              isFull
                ? "bg-transparent text-orange-600 hover:text-orange-600 dark:text-orange-300 dark:hover:text-orange-300"
                : "bg-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {isFull ? (
              <FullAccessIcon className={cn("thread-composer-access-icon mr-1.5 shrink-0", isHero ? "h-3.5 w-3.5" : "h-3.5 w-3.5")} />
            ) : (
              <RestrictedAccessIcon className={cn("thread-composer-access-icon mr-1.5 shrink-0", isHero ? "h-3.5 w-3.5" : "h-3.5 w-3.5")} />
            )}
            <span aria-hidden className="thread-composer-access-label-full min-w-0 truncate">
              {accessLabel}
            </span>
            <span aria-hidden className="thread-composer-access-label-short hidden min-w-0 truncate">
              {shortAccessLabel}
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="w-max max-w-[calc(100vw-2rem)] text-left leading-relaxed">
          {t(isFull ? "thread.composer.workspace.fullDescription" : "thread.composer.workspace.defaultDescription")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
