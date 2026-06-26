import { LogOut, Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";

// Confirmation shown before sign-out. clearConn wipes the key from this
// machine, so we give the user one last chance to copy it. Without this, a
// reflexive sign-out permanently orphans the identity.

const COPY_LIVE = "signout-copy-status";

export function SignOutConfirmDialog({
  open,
  onOpenChange,
  key_,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  key_: string | null;
  onConfirm: () => void;
}) {
  const { state, copy } = useCopy();
  const copied = state === "copied";
  const failed = state === "failed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] gap-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="h-5 w-5 text-human" aria-hidden />
            确认退出登录？
          </DialogTitle>
          <DialogDescription>
            退出会清除当前浏览器的登录密钥。之后若想回到这个身份（换浏览器、清缓存、重装），需要用到密钥。如果还没保存，请现在复制——退出后无法找回。
          </DialogDescription>
        </DialogHeader>

        {key_ && (
          <div className="space-y-2">
            <p id="signout-key-label" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              你的登录密钥
            </p>
            <output
              aria-labelledby="signout-key-label"
              className="block w-full break-all rounded-md border border-border bg-muted/40 p-3 font-mono text-sm text-foreground"
            >
              {key_}
            </output>
            <Button
              variant={copied ? "outline" : "secondary"}
              className="w-full gap-2"
              onClick={() => copy(key_)}
              aria-describedby={COPY_LIVE}
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" aria-hidden />
                  已复制
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" aria-hidden />
                  复制登录密钥
                </>
              )}
            </Button>

            {failed && (
              <p role="alert" className="text-sm text-destructive">
                复制失败——请手动选中上方的密钥进行复制。
              </p>
            )}

            <p
              id={COPY_LIVE}
              role="status"
              aria-live="polite"
              className="sr-only"
            >
              {copied ? "登录密钥已复制到剪贴板" : ""}
            </p>
          </div>
        )}

        <div className="flex flex-row gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            退出登录
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
