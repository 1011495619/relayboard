import { useEffect, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  FolderGit2,
  Plus,
  Search,
  Star,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  InputGroup,
  InputGroupInput,
  InputGroupAddon,
} from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import {
  readProjectPreferences,
  visitProject,
  toggleProjectPreference,
} from "@/lib/project-preferences";
import type { QueryResults } from "../types";

type Project = QueryResults["projects"][number];
const storageKey = "relayboard-project-preferences";

export function ProjectSwitcher({
  projects,
  projectId,
  onSelect,
  onCreate,
}: {
  projects: Project[];
  projectId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("active");
  const [storageError, setStorageError] = useState(false);
  const [preferences, setPreferences] = useState(() => {
    try {
      return readProjectPreferences(localStorage.getItem(storageKey));
    } catch {
      return readProjectPreferences(null);
    }
  });
  const current = projects.find((project) => project.id === projectId);

  useEffect(() => {
    if (projects.some((project) => project.id === projectId)) {
      setPreferences((previous) => visitProject(previous, projectId));
    }
  }, [projectId, projects]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(preferences));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [preferences]);

  const available = projects.filter(
    (project) =>
      (scope === "hidden"
        ? preferences.hidden.includes(project.id)
        : !preferences.hidden.includes(project.id)) &&
      `${project.name} ${project.root_path}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase()),
  );
  const favorite = available.filter((project) =>
    preferences.favorites.includes(project.id),
  );
  const recent = preferences.recent.flatMap((id) => {
    const project = available.find(
      (item) => item.id === id && !preferences.favorites.includes(id),
    );
    return project ? [project] : [];
  });
  const preferred = new Set(
    [...favorite, ...recent].map((project) => project.id),
  );
  const groups =
    scope === "hidden" || search.trim()
      ? [
          {
            label: scope === "hidden" ? "已收纳项目" : "搜索结果",
            projects: available,
          },
        ]
      : [
          { label: "收藏", projects: favorite },
          { label: "最近使用", projects: recent },
          {
            label: "其他项目",
            projects: available.filter((project) => !preferred.has(project.id)),
          },
        ];

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) {
          setSearch("");
          setScope("active");
        }
      }}
    >
      <Button
        render={<DialogTrigger />}
        variant="outline"
        size="workspace"
        aria-label={`切换项目：${current?.name || "选择项目"}`}
        className="project-switcher-trigger"
        title={current?.name}
      >
        <span className="project-switcher-heading">
          <span>当前项目</span>
          <span className="project-switcher-affordance">
            切换 <ChevronsUpDown aria-hidden="true" />
          </span>
        </span>
        <span className="project-switcher-current">
          <span className="project-switcher-mark">
            <FolderGit2 aria-hidden="true" />
          </span>
          <span className="project-switcher-name">
            {current?.name || "选择项目"}
          </span>
        </span>
      </Button>
      <DialogContent className="project-switcher-dialog sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>切换项目</DialogTitle>
          <DialogDescription>
            搜索名称或目录。收藏常用项目；收纳仅在本浏览器隐藏，任务和记录继续保留。
          </DialogDescription>
        </DialogHeader>
        <InputGroup>
          <InputGroupInput
            aria-label="搜索项目"
            placeholder="搜索项目名称或目录…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>
        <ToggleGroup
          value={[scope]}
          onValueChange={(value) => value[0] && setScope(value[0])}
          variant="outline"
          aria-label="项目显示范围"
        >
          <ToggleGroupItem value="active">
            项目{" "}
            {projects.length -
              preferences.hidden.filter((id) =>
                projects.some((p) => p.id === id),
              ).length}
          </ToggleGroupItem>
          <ToggleGroupItem value="hidden">
            已收纳{" "}
            {
              preferences.hidden.filter((id) =>
                projects.some((p) => p.id === id),
              ).length
            }
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="project-switcher-results" aria-label="项目列表">
          {groups
            .filter((group) => group.projects.length > 0)
            .map((group) => (
              <section
                key={group.label}
                aria-label={group.label}
                className="flex flex-col gap-1"
              >
                <h3 className="project-group-heading">{group.label}</h3>
                {group.projects.map((project) => (
                  <div key={project.id} className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="project"
                      className="min-w-0 flex-1 justify-start"
                      onClick={() => {
                        onSelect(project.id);
                        setOpen(false);
                      }}
                      aria-current={
                        project.id === projectId ? "true" : undefined
                      }
                    >
                      <FolderGit2 data-icon="inline-start" />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <strong className="project-option-name">
                          {project.name}
                        </strong>
                        <span
                          className="project-option-meta truncate"
                          title={project.root_path}
                        >
                          {project.task_count} 项任务 · {project.done_count}{" "}
                          项已验收
                        </span>
                      </span>
                      {project.id === projectId && (
                        <Badge variant="secondary">
                          <Check data-icon="inline-start" />
                          当前
                        </Badge>
                      )}
                    </Button>
                    <Button
                      variant={
                        preferences.favorites.includes(project.id)
                          ? "secondary"
                          : "ghost"
                      }
                      size="icon"
                      aria-label={`${preferences.favorites.includes(project.id) ? "取消收藏" : "收藏"}${project.name}`}
                      aria-pressed={preferences.favorites.includes(project.id)}
                      onClick={() =>
                        setPreferences((previous) =>
                          toggleProjectPreference(
                            previous,
                            "favorites",
                            project.id,
                          ),
                        )
                      }
                    >
                      <Star />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={project.id === projectId}
                      aria-label={`${scope === "hidden" ? "恢复" : "收纳"}${project.name}`}
                      title={
                        project.id === projectId
                          ? "先切换到其他项目，再收纳当前项目"
                          : undefined
                      }
                      onClick={() =>
                        setPreferences((previous) =>
                          toggleProjectPreference(
                            previous,
                            "hidden",
                            project.id,
                          ),
                        )
                      }
                    >
                      {scope === "hidden" ? <ArchiveRestore /> : <Archive />}
                    </Button>
                  </div>
                ))}
              </section>
            ))}
          {!available.length && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {search ? "没有匹配的项目" : "这里还没有项目"}
                </EmptyTitle>
                <EmptyDescription>
                  {search
                    ? "换个名称或目录关键词试试。"
                    : "收纳的项目会出现在这里，随时可以恢复。"}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
        {storageError && (
          <p role="status">本次偏好仅在当前窗口保留；浏览器存储暂不可用。</p>
        )}
        <Separator />
        <DialogFooter>
          <Button
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
          >
            <Plus data-icon="inline-start" />
            新建项目
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
