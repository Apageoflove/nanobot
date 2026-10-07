import { FullAccessIcon, WorkspaceIcon, RestrictedAccessIcon } from "@/components/icons/product-icons";
import type { HTMLAttributes, ReactElement } from "react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Search, Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ToggleButton } from "@/components/settings/ToggleButton";
import { Button } from "@/components/ui/button";
import { floatingItemClassName, floatingItemFocusClassName } from "@/components/ui/floating-surface";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { WorkspaceScopePayload, ProjectDirectory, WorkspaceDirectoriesPayload, WorkspacesPayload } from "@/lib/types";
import { createWorkspaceDirectoryCache } from "@/lib/workspace-directory-cache";
import { cn } from "@/lib/utils";
import { isAbsoluteWorkspacePath, projectNameFromPath, sameWorkspacePath, scopeWithAccessMode, workspacePathCompletionQuery, workspaceDirectoryPrefix, selectedProjectScope, type BrowseWorkspaceDirectories } from "@/lib/workspace";

function WorkspaceFavoriteButton({ path, pinned, busy, onToggle }: {
  path: string; pinned: boolean; busy: boolean; onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = t(pinned ? "workspace.picker.unpin" : "workspace.picker.pin", { name: projectNameFromPath(path) });
  return (
    <WorkspacePickerTooltip label={label}>
      <button type="button" aria-label={label} aria-pressed={pinned} disabled={busy}
        onMouseDown={event => event.preventDefault()} onClick={onToggle}
        className="workspace-picker-favorite touch-target absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-control text-muted-foreground outline-none hover:bg-foreground/[0.055] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none">
        <Star className={cn("h-3.5 w-3.5", pinned && "fill-current text-foreground")} />
      </button>
    </WorkspacePickerTooltip>
  );
}

type PickerColumn = { path: string; options: ProjectDirectory[]; selectedPath: string | null; hidden: boolean };

function WorkspacePickerTooltip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-[min(28rem,calc(100vw-2rem))] whitespace-pre-line break-all">{label}</TooltipContent>
    </Tooltip>
  );
}

const DIRECTORY_ROW_HEIGHT = 44;
const DIRECTORY_OVERSCAN = 4;

function WorkspaceDirectoryColumn({ options, activeIndex, renderOption, children, ...props }: {
  options: ProjectDirectory[];
  activeIndex: number | null;
  renderOption: (option: ProjectDirectory, index: number) => ReactElement;
} & HTMLAttributes<HTMLDivElement>) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [firstRow, setFirstRow] = useState(0);
  const [visibleRows, setVisibleRows] = useState(1);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setVisibleRows(Math.max(1, Math.ceil(viewport.clientHeight / DIRECTORY_ROW_HEIGHT)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = 0;
    setFirstRow(0);
  }, [options]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || activeIndex === null) return;
    const top = activeIndex * DIRECTORY_ROW_HEIGHT + 4;
    const bottom = top + DIRECTORY_ROW_HEIGHT;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (bottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = Math.max(0, bottom - viewport.clientHeight);
    setFirstRow(Math.floor(viewport.scrollTop / DIRECTORY_ROW_HEIGHT));
  }, [activeIndex, visibleRows, options]);
  const start = Math.max(0, firstRow - DIRECTORY_OVERSCAN);
  const end = Math.min(options.length, firstRow + visibleRows + DIRECTORY_OVERSCAN);
  return (
    <div {...props} ref={viewportRef} onScroll={event => setFirstRow(Math.floor(event.currentTarget.scrollTop / DIRECTORY_ROW_HEIGHT))}>
      <div role="presentation" className="relative" style={{ height: options.length * DIRECTORY_ROW_HEIGHT }}>
        {options.slice(start, end).map((option, offset) => {
          const index = start + offset;
          return <div key={option.path} role="presentation" className="absolute inset-x-0" style={{ top: index * DIRECTORY_ROW_HEIGHT }}>
            {renderOption(option, index)}
          </div>;
        })}
      </div>
      {children}
    </div>
  );
}

function WorkspaceDirectorySkeleton() {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(1);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setRows(Math.max(1, Math.ceil(viewport.clientHeight / DIRECTORY_ROW_HEIGHT)));
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

export function WorkspaceProjectPicker({ isHero, disabled, scope, defaultScope, controls, error, onLoadProjects, onResolveProject, onFavoriteProject, onBrowseDirectories, layoutAnchor, onChange }: {
  layoutAnchor?: HTMLElement | null;
  isHero: boolean;
  disabled?: boolean;
  scope: WorkspaceScopePayload | null;
  defaultScope: WorkspaceScopePayload | null;
  controls: WorkspacesPayload["controls"] | null;
  error?: string | null;
  onResolveProject: (path: string) => Promise<ProjectDirectory>;
  onLoadProjects: () => Promise<WorkspacesPayload>;
  onFavoriteProject: (path: string, pinned: boolean) => Promise<ProjectDirectory[]>;
  onBrowseDirectories: BrowseWorkspaceDirectories;
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
  const [visibleColumns, setVisibleColumns] = useState(3);
  const pickerSession = useRef(0);
  const completionRequest = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const keyboardInteraction = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionsId = useId();
  const errorId = useId();
  const currentProjectScope = selectedProjectScope(scope, defaultScope);
  const displayedScope = scope ?? defaultScope;
  const projectLabel = displayedScope ? displayedScope.project_name || projectNameFromPath(displayedScope.project_path) : "";
  const visible = isHero && !!defaultScope && !!onChange && controls?.can_change_project !== false;
  const directoryCache = useMemo(() => createWorkspaceDirectoryCache(onBrowseDirectories), [onBrowseDirectories]);
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
    setPathDraft(workspaceDirectoryPrefix(initialPath));
    setBasePath(initialPath);
    setDirectory(null);
    setActiveIndex(0);
    setPathError(null);
  }, [scope?.project_path, defaultScope?.project_path, open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setCatalog(null);
    onLoadProjects().then(payload => { if (active) setCatalog(payload); }).catch((err: Error) => { if (active) setPathError(err.message); });
    return () => { active = false; };
  }, [onLoadProjects, open]);

  useEffect(() => {
    if (!open) return;
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
  }, [open, directoryCache, requestedPath, folderQuery, showHidden, revision, absoluteDraft, pathDraft]);

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
  useEffect(() => {
    if (!open) return;
    const paths: string[] = JSON.parse(ancestorPaths);
    if (!paths.length) return;
    let active = true;
    Promise.all(paths.map(path => directoryCache.load(path, "", showHidden, true))).then(results => {
      if (!active) return;
      setPreviousColumns(columns => columns.map(column => {
        const result = results.find(result => sameWorkspacePath(column.path, result.path));
        if (!result) return column;
        return { ...column, hidden: showHidden, options: result.entries };
      }));
    }).catch((err: Error) => { if (active) setPathError(err.message); });
    return () => { active = false; };
  }, [open, directoryCache, ancestorPaths, showHidden]);

  useLayoutEffect(() => {
    const viewport = columnsElement;
    if (!open || !viewport) return;
    const measure = () => setVisibleColumns(Math.max(1, Math.min(3, Math.floor(viewport.clientWidth / 240))));
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

  useLayoutEffect(() => {
    const viewport = columnsRef.current;
    if (!viewport || !highlightActive) return;
    const width = viewport.clientWidth / visibleColumns;
    const left = activeColumn * width;
    const right = left + width;
    if (left < viewport.scrollLeft) viewport.scrollLeft = left;
    else if (right > viewport.scrollLeft + viewport.clientWidth) viewport.scrollLeft = right - viewport.clientWidth;
  }, [activeColumn, highlightActive, visibleColumns]);

  function changeDraft(value: string, resetColumns = true) {
    setHighlightActive(false);
    if (resetColumns) { setPreviousColumns([]); setActiveColumn(0); }
    completionRequest.current += 1;
    setPathDraft(value);
    const absolute = isAbsoluteWorkspacePath(value);
    const cached = directoryCache.peek(absolute ? value.trim() : basePath, absolute ? "" : value.trim(), showHidden, true);
    setDirectory(cached ?? null);
    setLoading(!cached);
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

  const applyProjectPath = useCallback((path: string, name: string) => {
    const base = scope ?? defaultScope;
    const trimmed = path.trim();
    if (!base || !onChange) return;
    const accessMode = controls?.can_use_full_access === false && !sameWorkspacePath(trimmed, base.project_path) ? "restricted" : base.access_mode;
    onChange({ ...base, project_path: trimmed, project_name: name, access_mode: accessMode, restrict_to_workspace: accessMode === "restricted" });
    setPathError(null);
    setOpen(false);
  }, [controls?.can_use_full_access, defaultScope, onChange, scope]);

  const chooseProject = useCallback(async (path: string) => {
    const session = pickerSession.current;
    setPickingFolder(true); setPathError(null);
    try {
      const project = await onResolveProject(path);
      if (session === pickerSession.current) applyProjectPath(project.path, project.name);
    } catch (err) {
      if (session === pickerSession.current) setPathError((err as Error).message);
    } finally { setPickingFolder(false); }
  }, [applyProjectPath, onResolveProject]);

  const favorites = catalog?.favorite_projects ?? [];
  const canFavorite = catalog !== null;
  const isFavorite = (path: string) => favorites.some(item => sameWorkspacePath(item.path, path));
  function favoriteButton(path: string) {
    return canFavorite ? <WorkspaceFavoriteButton path={path} pinned={isFavorite(path)} busy={favoriteBusy || pickingFolder}
      onToggle={() => { void toggleFavorite(path); inputRef.current?.focus(); }} /> : null;
  }

  const toggleFavorite = async (path: string) => {
    if (favoriteBusy) return;
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
    ...(defaultScope ? [{ name: projectNameFromPath(defaultScope.project_path), path: defaultScope.project_path }] : []),
    ...(currentProjectScope ? [{ name: projectLabel, path: currentProjectScope.project_path }] : []),
  ].filter((project, index, all) => all.findIndex(item => sameWorkspacePath(item.path, project.path)) === index && !isFavorite(project.path));
  const options = useMemo(() => directory && !loading ? directory.entries : [], [directory, loading]);
  function openShortcut(project: ProjectDirectory) {
    setBasePath(project.path);
    changeDraft(workspaceDirectoryPrefix(project.path));
    setRevision(value => value + 1);
    inputRef.current?.focus();
  }
  const columns: PickerColumn[] = [...previousColumns, { path: directory?.path ?? requestedPath, options, selectedPath: null, hidden: showHidden }];
  const activeOptions = columns[activeColumn]?.options ?? options;
  const activeOption = Math.min(activeIndex, Math.max(activeOptions.length - 1, 0));
  const selectionPath = !loading && directory && !directory.partial ? directory.path : null;
  const displayedError = pathError ?? error ?? directoryError;

  async function completePath() {
    const option = activeOptions[activeOption];
    if (option) { navigate(option.path); return; }
    const request = workspacePathCompletionQuery(pathDraft) ?? { path: basePath, query: pathDraft.trim() };
    const id = ++completionRequest.current;
    const session = pickerSession.current;
    try {
      const result = await directoryCache.load(requestedPath, folderQuery, showHidden || request.query.startsWith("."), true);
      if (id !== completionRequest.current || session !== pickerSession.current) return;
      if (absoluteDraft && !result.partial && request.query) { navigate(result.path); return; }
      const prefix = request.query.toLocaleLowerCase();
      const first = result.entries.find(entry => entry.name.toLocaleLowerCase().startsWith(prefix));
      if (first) navigate(first.path);
    } catch (err) {
      if (id === completionRequest.current && session === pickerSession.current) setPathError((err as Error).message);
    }
  }
  function activate(option: ProjectDirectory, columnIndex = activeColumn) {
    if (pickingFolder) return;
    navigate(option.path, columnIndex);
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
            <Input ref={inputRef} role="combobox" aria-expanded={open} aria-controls={`${optionsId}-${activeColumn}`} aria-activedescendant={activeOptions.length ? `${optionsId}-${activeColumn}-${activeOption}` : undefined} aria-autocomplete="list" aria-busy={loading} value={pathDraft} disabled={disabled || pickingFolder} onChange={event => changeDraft(event.target.value)} placeholder={t("workspace.picker.search")} aria-label={t("workspace.picker.search")} aria-invalid={displayedError || directoryError ? true : undefined} aria-describedby={displayedError || directoryError ? errorId : undefined} className="h-10 min-w-0 flex-1 border-0 bg-transparent pl-10 pr-3 text-[14px] shadow-none focus-visible:ring-0" onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.altKey && activeOptions.length) {
                event.preventDefault();
                const next = (activeOption + (event.key === "ArrowDown" ? 1 : -1) + activeOptions.length) % activeOptions.length;
                setHighlightActive(true); setActiveIndex(next);
              } else if (event.key === "ArrowLeft" && activeColumn > 0 && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) {
                event.preventDefault();
                const parent = columns[activeColumn - 1];
                setHighlightActive(true);
                setActiveColumn(activeColumn - 1);
                setActiveIndex(Math.max(0, parent.options.findIndex(option => sameWorkspacePath(option.path, parent.selectedPath))));
              } else if (event.key === "Tab" && !event.shiftKey && !!pathDraft.trim() || event.key === "ArrowRight" && !event.shiftKey && event.currentTarget.selectionStart === pathDraft.length && event.currentTarget.selectionEnd === pathDraft.length) {
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
                  {section.projects.map(project => <div key={project.path} className="workspace-picker-row relative">
                    <button type="button" aria-label={project.path} aria-current={sameWorkspacePath(basePath, project.path) ? "location" : undefined}
                      disabled={pickingFolder} onMouseDown={event => event.preventDefault()} onClick={() => openShortcut(project)}
                      className={cn(floatingItemClassName, floatingItemFocusClassName, "flex min-h-11 w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-foreground/[0.055] dark:hover:bg-white/[0.08]", canFavorite && "pr-12", sameWorkspacePath(basePath, project.path) && "bg-primary/10 text-primary")}>
                      <WorkspacePickerPath path={project.path} />
                      {sameWorkspacePath(project.path, scope?.project_path ?? defaultScope.project_path) && <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    </button>
                    {favoriteButton(project.path)}
                  </div>)}
                  {section.favorite && !favorites.length && canFavorite && <p className="px-3 text-[11px] leading-relaxed text-muted-foreground">{t("workspace.picker.favoriteHint")}</p>}
                </section>
              ))}
            </nav>
            <div ref={attachColumns} data-workspace-columns className="flex flex-1 min-h-0 min-w-0 overflow-x-auto overscroll-x-contain">
              {columns.map((column, columnIndex) => <WorkspaceDirectoryColumn key={columnIndex} options={column.options} activeIndex={highlightActive && columnIndex === activeColumn ? activeOption : null}
                id={`${optionsId}-${columnIndex}`} role="listbox" aria-label={column.path || t("thread.composer.workspace.projectAria")} aria-busy={columnIndex === previousColumns.length && loading} style={{ width: `${100 / visibleColumns}%` }} className={cn("min-w-0 shrink-0 overflow-x-hidden overflow-y-auto border-r border-transparent px-1 py-1", !!columns[columnIndex + 1]?.options.length && "border-border/50")}
                renderOption={(option, index) => <div role="presentation" className="workspace-picker-row relative" data-keyboard-active={highlightActive && columnIndex === activeColumn && index === activeOption ? "" : undefined}>
                  <button id={`${optionsId}-${columnIndex}-${index}`} type="button" role="option" aria-label={option.path} aria-selected={sameWorkspacePath(column.selectedPath, option.path)} aria-posinset={index + 1} aria-setsize={column.options.length} disabled={pickingFolder}
                    onPointerMove={() => { setHighlightActive(false); setActiveColumn(columnIndex); setActiveIndex(index); }}
                    onMouseDown={event => event.preventDefault()} onClick={() => activate(option, columnIndex)}
                    className={cn(floatingItemClassName, floatingItemFocusClassName, "flex min-h-11 w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-foreground/[0.055] dark:hover:bg-white/[0.08] disabled:opacity-50", canFavorite && "pr-12",
                      sameWorkspacePath(column.selectedPath, option.path) && "bg-primary/10 text-primary font-medium hover:bg-primary/10",
                      highlightActive && columnIndex === activeColumn && index === activeOption && "ring-1 ring-inset ring-ring")}>
                    <WorkspacePickerTooltip label={option.path}><span className="min-w-0 flex-1 truncate text-[13px]">{option.name}</span></WorkspacePickerTooltip>
                    {sameWorkspacePath(option.path, scope?.project_path ?? defaultScope.project_path) && <Check className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  </button>
                  {favoriteButton(option.path)}
              </div>}>
              {columnIndex === previousColumns.length && loading && <WorkspaceDirectorySkeleton />}
              {columnIndex === previousColumns.length && directory?.truncated && <p className="px-3 py-2 text-[11px] text-muted-foreground">{t("workspace.picker.truncated")}</p>}
              {columnIndex === previousColumns.length && displayedError && <p id={errorId} role="alert" className="px-3 py-2 text-[11.5px] text-destructive">{displayedError}</p>}
              </WorkspaceDirectoryColumn>)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 px-2 pt-1">
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground"><ToggleButton checked={showHidden} onChange={setShowHidden} label={t("workspace.picker.hidden")} />{t("workspace.picker.hidden")}</label>
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
