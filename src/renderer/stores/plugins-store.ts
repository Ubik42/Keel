import { createFieldStore } from './create-field-store';

export interface PluginsState {
  pluginContributionEpoch: number;
  // @fields
}

export const pluginsFields = createFieldStore<PluginsState>(() => ({
    pluginContributionEpoch: 0,
    // @initial
}));

export const usePluginsField = pluginsFields.useField;
