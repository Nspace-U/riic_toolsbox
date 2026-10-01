import type {
  BasePointDetail,
  DroneAccelerationCandidate,
  DroneAccelerationDetail,
  EfficiencyFacility,
  EfficiencyPlanResult,
  FacilityEfficiencyResult,
  MoodSnapshot,
} from "./efficiency";
import type { RoomKey } from "./schedule";
import type { SanityResult } from "../utils/sanity";

export interface EfficiencyCalculationStepView {
  plan: EfficiencyPlanResult;
  planIndex: number;
  facility?: FacilityEfficiencyResult;
  moods: MoodSnapshot[];
  droneAccelerations?: DroneAccelerationDetail[];
}

export interface EfficiencyCalculationStepGroupColumn {
  plan: EfficiencyPlanResult;
  planIndex: number;
  step?: EfficiencyCalculationStepView;
}

export interface EfficiencyCalculationStepGroup {
  key: string;
  label: string;
  activeColumnCount: number;
  columns: EfficiencyCalculationStepGroupColumn[];
}

export interface DailyOutputOrderDetail {
  name: string;
  probability: number;
  baseRate: number;
  totalRate: number;
  ignoreEfficiency?: boolean;
}

export interface DailyOutputMaterialDetail {
  material: string;
  baseAmountPerHour: number;
  dailyAmount: number;
  queueTotal: number;
}

export interface DailyOutputFacilityDetail {
  label: string;
  baseEfficiency: number;
  totalEfficiency: number;
  baseOutputPerHour: number;
  totalOutputPerHour: number;
  selectedOutputPerHour: number;
  materials: DailyOutputMaterialDetail[];
  orders: DailyOutputOrderDetail[];
}

export interface DailyOutputProductDetail {
  product: string;
  baseEfficiency: number;
  totalEfficiency: number;
  baseOutputPerHour: number;
  totalOutputPerHour: number;
  selectedOutputPerHour: number;
  dailyContribution: number;
  queueTotal: number;
  materials: DailyOutputMaterialDetail[];
  facilities: DailyOutputFacilityDetail[];
}

export interface DailyOutputQueueDetail {
  plan: EfficiencyPlanResult;
  planIndex: number;
  products: DailyOutputProductDetail[];
  sanity: SanityResult;
}

export interface BasePointQueueDetail {
  plan: EfficiencyPlanResult;
  planIndex: number;
  points: BasePointDetail[];
}

export interface MaaDroneQueueDetail {
  plan: EfficiencyPlanResult;
  planIndex: number;
  details: DroneAccelerationDetail[];
  candidates: DroneAccelerationCandidate[];
}

export interface DailyOutputCard {
  product: string;
  sourceFacility?: RoomKey;
  grossAmount?: number;
  grossPoints?: number;
  grossPointsLabel?: string;
  netAmount: number;
  netResourceAmount: number;
  netUnit: string;
  netContribution?: number;
  showNet: boolean;
}

export interface DroneScenarioView {
  key: "extra" | "accelerated";
  label: string;
  cards: DailyOutputCard[];
}

export interface DroneScenarioDisplay {
  scenario: import("../utils/efficiency/drone").DroneAccelerationScenario;
  views: DroneScenarioView[];
}

export interface ResultPresentationData {
  calculationSteps: EfficiencyCalculationStepView[];
  calculationStepGroups: EfficiencyCalculationStepGroup[];
  dailyOutputQueueDetails: DailyOutputQueueDetail[];
  dailySanityAmounts: import("../utils/sanity").SanityResourceAmounts;
  dailySanityResult: SanityResult;
  dailyOutputCards: DailyOutputCard[];
  droneScenarioDisplays: DroneScenarioDisplay[];
  basePointQueueDetails: BasePointQueueDetail[];
  maaDroneQueueDetails: MaaDroneQueueDetail[];
}

export interface ResultPresentationOptions {
  sanityValues: import("../utils/sanity").SanityValues;
  visibleBasePointTerms?: ReadonlySet<string>;
  droneAcceleration?: import("../utils/efficiency/drone").DroneAccelerationResult;
  sourceFacilityForProduct?: (product: string) => RoomKey | undefined;
  facilityLabel?: (facility: FacilityEfficiencyResult) => string;
  basePointLabel?: (term: string) => string;
}

export type ResultPresentationFacility = EfficiencyFacility;
