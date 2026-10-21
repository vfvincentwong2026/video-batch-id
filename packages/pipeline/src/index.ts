/**
 * @vbid/pipeline —— 工作流 A 编排（参考素材二创）
 *
 * README 链路：上传 → 解析 → 勾选变量 → 设变体数 → 生成 → 双守卫 → 审核 → 谱系入库。
 * 本包实现「解析 → 采样 → 生成 → 守卫」机器段；审核与入库由 API/Web 层负责。
 *
 * Provider 策略（PM 裁决）：
 *  - 生成层抽象为 VariantGeneratorProvider，v0.1 只有 MockGenerator；
 *    云 GPU（ComfyUI+Wan2.2）与第三方视频 API 后续以同接口接入，编排层零改动。
 *  - 双守卫同理：v0.1 为 HeuristicGuard（基于变量取值的确定性启发式，用于打通链路）；
 *    真实 CLIP+GroundingDINO / pHash+Chromaprint 后置（v0.2，需 GPU）。
 */

import {
  createMatrix,
  sampleVariants,
  estimateCost,
  type VariantSpec,
  type VariableMatrix,
  type Dimension,
} from '@vbid/variable-matrix';
import {
  getParser,
  deriveMatrixHints,
  type ParsedReference,
  type ParseInput,
  type ParserProvider,
} from '@vbid/reference-parser';

// ---------- 生成 provider ----------

export interface GenerateInput {
  taskId: string;
  variant: VariantSpec;
  master: { assetId: string; filename: string };
  parsed: ParsedReference;
  matrix: VariableMatrix;
}

export interface GeneratedVariant {
  /** 产出物引用。mock 为 mock:// 伪协议；真实实现为文件路径或对象存储 key */
  fileRef: string;
  /** 生成描述（prompt 摘要），便于审核页展示 */
  descriptor: string;
  generator: string;
}

export interface VariantGeneratorProvider {
  name: string;
  generate(input: GenerateInput): Promise<GeneratedVariant>;
}

/** v0.1 mock：不产真实视频，产出确定性描述与伪文件引用 */
export class MockGeneratorProvider implements VariantGeneratorProvider {
  name = 'mock';

  async generate(input: GenerateInput): Promise<GeneratedVariant> {
    const { variant, matrix, master } = input;
    const parts = matrix.dimensions
      .filter((d) => d.enabled && variant.assignments[d.key])
      .map((d) => {
        const opt = d.options.find((o) => o.id === variant.assignments[d.key]);
        return `${d.label}=${opt?.label ?? variant.assignments[d.key]}`;
      });
    const descriptor = `[二创变体] ${parts.join(' · ')} ← ${master.filename}`;
    const hash = Buffer.from(descriptor).toString('base64url').slice(0, 10);
    return {
      fileRef: `mock://variants/${variant.id}-${hash}.mp4`,
      descriptor,
      generator: this.name,
    };
  }
}

const generatorRegistry = new Map<string, VariantGeneratorProvider>();
export function registerGenerator(g: VariantGeneratorProvider): void {
  generatorRegistry.set(g.name, g);
}
registerGenerator(new MockGeneratorProvider());
export function getGenerator(name = 'mock'): VariantGeneratorProvider {
  const g = generatorRegistry.get(name);
  if (!g) throw new Error(`unknown generator: ${name}`);
  return g;
}

// ---------- 双守卫 ----------

export interface GuardResult {
  passed: boolean;
  /** 0..1；保真为一致度（越高越好），去重为相似度（越低越好） */
  score: number;
  detail: string;
}

export interface FidelityGuard {
  name: string;
  check(input: GenerateInput, generated: GeneratedVariant): Promise<GuardResult>;
}

export interface DedupGuard {
  name: string;
  /** 变体与其全部前驱（同任务内已接受变体 + Master）比较，取最差值 */
  check(input: GenerateInput, generated: GeneratedVariant, predecessors: GeneratedVariant[]): Promise<GuardResult>;
}

export const FIDELITY_THRESHOLD = 0.92; // README 默认
export const DEDUP_THRESHOLD = 0.65;    // README 默认（黑盒，v0.6 用投放数据校准）

/**
 * v0.1 启发式保真守卫：一致性 = 1 - （启用维度中偏离 Master 锁定的比例）× 0.05，
 * 确定性输出。真实实现（CLIP embedding + GroundingDINO 产品区域检测）后置。
 */
export class HeuristicFidelityGuard implements FidelityGuard {
  name = 'heuristic-fidelity';

  async check(input: GenerateInput): Promise<GuardResult> {
    const lockedCount = input.matrix.dimensions.reduce((acc, d) => acc + d.locked.length, 0);
    // 基础漂移 0.06，每项锁定 -0.005，下限 0.01：锁得越多漂移越小
    const drift = Math.max(0.01, 0.06 - lockedCount * 0.005);
    const score = Number((1 - drift).toFixed(3));
    return {
      passed: score >= FIDELITY_THRESHOLD,
      score,
      detail: `locked=${lockedCount} drift=${drift}`,
    };
  }
}

/**
 * v0.1 启发式去重守卫：以变量取值的重合度估算相似度。
 * 真实实现（pHash + 关键帧 CLIP 距离 + 音频指纹）后置。
 */
export class HeuristicDedupGuard implements DedupGuard {
  name = 'heuristic-dedup';

  async check(input: GenerateInput, generated: GeneratedVariant, predecessors: GeneratedVariant[]): Promise<GuardResult> {
    const keys = input.matrix.dimensions.filter((d) => d.enabled).map((d) => d.key);
    if (predecessors.length === 0 || keys.length === 0) {
      return { passed: true, score: 0, detail: 'no predecessors' };
    }
    let worst = 0;
    for (const pred of predecessors) {
      // 从描述还原前驱取值不可行 → 用 fileRef 差异位 + 序位估算（mock 语义）
      const sameBits = [...generated.fileRef].filter((c, i) => pred.fileRef[i] === c).length;
      const sim = sameBits / Math.max(generated.fileRef.length, pred.fileRef.length);
      worst = Math.max(worst, sim);
    }
    const score = Number(worst.toFixed(3));
    return {
      passed: score < DEDUP_THRESHOLD,
      score,
      detail: `worst-similarity vs ${predecessors.length} predecessors`,
    };
  }
}

// ---------- 工作流 A 编排 ----------

export interface WorkflowAInput {
  masterAssetId: string;
  masterFilename: string;
  durationMs: number;
  variantCount: number;
  seed?: number;
  /** 覆盖矩阵（运营勾选结果）；缺省用解析推导的默认矩阵 */
  dimensions?: Dimension[];
}

export interface WorkflowAVariant {
  spec: VariantSpec;
  generated: GeneratedVariant;
  fidelity: GuardResult;
  dedup: GuardResult;
  accepted: boolean;
}

export interface WorkflowAResult {
  masterAssetId: string;
  parsed: ParsedReference;
  matrix: VariableMatrix;
  cost: ReturnType<typeof estimateCost>;
  variants: WorkflowAVariant[];
  acceptedCount: number;
  rejectedCount: number;
}

export interface PipelineDeps {
  parser?: ParserProvider;
  generator?: VariantGeneratorProvider;
  fidelityGuard?: FidelityGuard;
  dedupGuard?: DedupGuard;
  /** 谱系/存储挂钩：每产出一条变体回调一次（API 层写入 SQLite） */
  onVariant?: (v: WorkflowAVariant, index: number) => void;
}

export async function runWorkflowA(input: WorkflowAInput, deps: PipelineDeps = {}): Promise<WorkflowAResult> {
  const parser = deps.parser ?? getParser('mock');
  const generator = deps.generator ?? getGenerator('mock');
  const fidelityGuard = deps.fidelityGuard ?? new HeuristicFidelityGuard();
  const dedupGuard = deps.dedupGuard ?? new HeuristicDedupGuard();

  // ① 解析
  const parseInput: ParseInput = {
    assetId: input.masterAssetId,
    filename: input.masterFilename,
    durationMs: input.durationMs,
  };
  const parsed = await parser.parse(parseInput);

  // ② 变量矩阵（自定义勾选 优先；否则从解析推导）
  let matrix: VariableMatrix;
  if (input.dimensions) {
    matrix = createMatrix(input.dimensions);
  } else {
    const hints = deriveMatrixHints(parsed);
    const { defaultDimensions } = await import('@vbid/variable-matrix');
    const dims = defaultDimensions();
    dims[0].options = hints.visualOptions;
    dims[1].options = hints.copyOptions;
    matrix = createMatrix(dims);
  }

  // ③ 最大差异度采样
  const specs = sampleVariants(matrix, input.variantCount, input.seed ?? 42);

  // ④ 逐条生成 + 双守卫
  const taskId = `wf_${input.masterAssetId}`;
  const variants: WorkflowAVariant[] = [];
  const accepted: GeneratedVariant[] = [];
  for (let i = 0; i < specs.length; i++) {
    const genInput: GenerateInput = {
      taskId,
      variant: specs[i],
      master: { assetId: input.masterAssetId, filename: input.masterFilename },
      parsed,
      matrix,
    };
    const generated = await generator.generate(genInput);
    const fidelity = await fidelityGuard.check(genInput, generated);
    // 去重只与「已接受」前驱比较——未通过守卫的废片不混入合格队列（README 硬门槛）
    const dedup = await dedupGuard.check(genInput, generated, [...accepted]);
    const passed = fidelity.passed && dedup.passed;
    const wv: WorkflowAVariant = { spec: specs[i], generated, fidelity, dedup, accepted: passed };
    variants.push(wv);
    if (passed) accepted.push(generated);
    deps.onVariant?.(wv, i);
  }

  return {
    masterAssetId: input.masterAssetId,
    parsed,
    matrix,
    cost: estimateCost(specs.length),
    variants,
    acceptedCount: accepted.length,
    rejectedCount: variants.length - accepted.length,
  };
}
