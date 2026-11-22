import { createFieldStore } from './create-field-store';
import { type AiJobStatus, type MediaJobStatus, type PluginJobStatus } from '../../shared/library-api';

export interface JobsState {
  mediaJobs: MediaJobStatus | null;
  aiJobs: AiJobStatus | null;
  pluginJobs: PluginJobStatus | null;
  hiddenPluginJobActivityId: string | null;
  mediaJobsLoading: boolean;
  // @fields
}

export const jobsFields = createFieldStore<JobsState>(() => ({
    mediaJobs: null,
    aiJobs: null,
    pluginJobs: null,
    hiddenPluginJobActivityId: null,
    mediaJobsLoading: false,
    // @initial
}));

export const useJobsField = jobsFields.useField;
