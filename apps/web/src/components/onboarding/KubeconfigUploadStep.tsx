import { type ChangeEvent, type DragEvent } from "react";
import { Icon } from "../ui/Icon";
import { mdiUpload } from "@mdi/js";

interface KubeconfigUploadStepProps {
  kubeconfigFile: File | null;
  fileError: string;
  isDragging: boolean;
  setIsDragging: (val: boolean) => void;
  onFileSelected: (file: File | undefined) => void;
  onRemoveFile: () => void;
}

export function KubeconfigUploadStep({
  kubeconfigFile,
  fileError,
  isDragging,
  setIsDragging,
  onFileSelected,
  onRemoveFile,
}: KubeconfigUploadStepProps) {
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFileSelected(event.target.files?.[0]);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    onFileSelected(event.dataTransfer.files?.[0]);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-[#E6E1E5]">Kubeconfig File</p>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`rounded-xl border border-dashed p-8 text-center transition-colors ${
            isDragging ? "border-blue-500 bg-blue-500/10" : "border-[#30343B] bg-[#111318]"
          }`}
        >
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Icon path={mdiUpload} size={0.83} />
          </div>
          <p className="text-[#E6E1E5] text-sm">Drag & drop your kubeconfig here</p>
          <p className="my-1.5 text-xs text-[#92959D]">or</p>
          <p className="mb-3 text-xs text-[#92959D]">YAML files only (.yaml, .yml)</p>
          <label className="inline-flex cursor-pointer rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 transition-colors font-semibold">
            Browse File
            <input type="file" accept=".yaml,.yml" className="hidden" onChange={handleFileChange} />
          </label>

          {kubeconfigFile && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <p className="text-sm text-emerald-400 font-mono">Selected: {kubeconfigFile.name}</p>
              <button
                type="button"
                onClick={onRemoveFile}
                className="text-sm text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            </div>
          )}
          {fileError && <p className="mt-4 text-sm text-red-400">{fileError}</p>}
        </div>
      </div>
    </div>
  );
}
