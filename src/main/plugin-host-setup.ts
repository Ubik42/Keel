import path from 'node:path';
import { state } from './main-state';
import { ScriptRuntimeSupervisor } from './script-runtime-supervisor';
import { utilityProcess, app } from 'electron';
import { RuleRunner } from './rule-runner';
import { confirmRuleRun } from './desktop-confirmations';
import { RULE_RUN_RECORDED_CHANNEL, COMMAND_COMPLETED_CHANNEL, MCP_SETTINGS_EVENT_CHANNEL } from '../shared/protocol/channels';
import { runScheduledRules } from './rule-triggers';
import { type PluginRuntimeHostCommandHandler, type PluginRuntimeStorageHandler, type PluginRuntimeJobEnqueueHandler, type PluginRuntimeJobProgressHandler, type PluginRuntimeJobControlHandler, type PluginRuntimeInputCaptureStartHandler, PluginRuntimeSupervisor } from './plugin-runtime-supervisor';
import { validatePluginCauseChain } from '../plugins/plugin-domain-events';
import { resolvePluginHostCommandLibraryId, pluginHostCommandRequiresBoundLibrary } from '../plugins/plugin-host-command-target';
import { pluginAutomationContexts } from './library-ipc';
import { automationCapabilitiesFromPluginPermissions } from '../plugins/plugin-permission-capabilities';
import { normalizeAutomationAssetSearchInput } from './normalize-automation-asset-search-input';
import { AUTOMATION_API_VERSION } from '../automation/command-registry';
import { PluginHostCommandError } from '../shared/plugin-host-command-error';
import { PluginStorageStore, PluginStorageStoreError } from './plugin-storage-store';
import { PluginSettingsStore } from './plugin-settings-store';
import { PluginMcpExposureStore } from './plugin-mcp-exposure-store';
import { PluginActivationCoordinator } from './plugin-activation-coordinator';
import { pluginTargetLibraryIdSchema } from '../plugins/plugin-commands';
import { pluginJobOwnerCanRetry, pluginJobOwnerMatches } from '../plugins/plugin-jobs';
import { PluginInputCaptureBroker } from '../shared/plugin-input-capture';
import { publishPluginInputCaptureSessionsToRenderer } from './main-window';
import { PluginTrustedRuntimeSupervisor } from './plugin-trusted-runtime-supervisor';
import { currentPluginCompatibilityPlatform } from './plugin-platform';
import { PluginPackageManager } from './plugin-package-manager';
import { loadOrCreatePluginDeviceId } from './plugin-device-identity';
import { PLUGIN_API_VERSION } from '../plugins/plugin-manifest';
import { createContributionRegistry } from '../plugins/plugin-contributions';
import { createPluginProviderRegistry } from '../plugins/plugin-providers';
import { syncPluginThumbnailExtensions } from './library-opened';
import { PluginMcpToolProvider } from './plugin-mcp-tool-provider';
import { PluginJobScheduler } from './plugin-job-scheduler';
import { PluginProviderScheduler } from './plugin-provider-scheduler';
import { EmbeddedMcpServer } from './embedded-mcp-server';
import { ruleMcpTools } from './rule-host-tools';
import { mcpSettingsSnapshotSchema } from '../shared/mcp';
import { McpCredentialStoreError } from './mcp-client-credentials';

/**
 * Script runtime, rule runner and the plugin host: storage, settings, jobs, providers, input capture and the restricted and trusted runtimes (split out of startApplication, P8).
 */
export async function setUpPluginHost() {
  if (!state.logger || !state.workerClient) throw new Error('Logger and library worker must start before the plugin host.');
  state.scriptRuntimeSupervisor = new ScriptRuntimeSupervisor({
    modulePath: path.join(__dirname, 'script_runtime_utility.js'),
    fork: (modulePath) => utilityProcess.fork(modulePath, [], {
      serviceName: 'Keel Script Runtime',
      stdio: 'pipe',
    }),
    logger: state.logger,
  });
  state.ruleRunner = new RuleRunner({
    workerClient: () => state.workerClient,
    journal: () => state.automationExecutionJournal,
    gateway: () => state.automationCommandGateway,
    runtime: () => state.scriptRuntimeSupervisor,
    confirmDesktopWrite: confirmRuleRun,
    logger: () => state.logger,
    onRunRecorded: (libraryId, run) => {
      if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
      state.mainWindow.webContents.send(RULE_RUN_RECORDED_CHANNEL, { libraryId, ruleId: run.ruleId, runId: run.runId });
    },
  });
  setInterval(() => { void runScheduledRules(); }, 60_000).unref?.();
  const executePluginHostCommand: PluginRuntimeHostCommandHandler = async (commandId, input, context) => {
    const gateway = state.automationCommandGateway;
    if (gateway === undefined) throw new Error('Automation Gateway is unavailable.');
    const cause = validatePluginCauseChain(context.causeChain);
    if (!cause.ok) {
      throw new Error(cause.message);
    }
    const resolvedTarget = resolvePluginHostCommandLibraryId({
      commandId,
      libraryId: context.libraryId,
      ...(context.targetLibraryId === undefined ? {} : { targetLibraryId: context.targetLibraryId }),
    });
    if (!resolvedTarget.ok) {
      throw new Error(resolvedTarget.message);
    }
    const activeInstance = state.pluginActivationCoordinator?.findActiveInstance(context.instanceId);
    if (activeInstance === undefined) {
      throw new Error('The plugin instance is no longer active.');
    }
    let boundLibraryId = resolvedTarget.libraryId;
    if (boundLibraryId !== null) {
      if (activeInstance.instanceScope === 'library'
        && activeInstance.activationLibraryId !== boundLibraryId) {
        throw new Error('A library-scoped plugin cannot target another library.');
      }
      const libraries = await state.workerClient?.request({ type: 'library.list' });
      const libraryIsOpen = libraries?.ok === true
        && libraries.type === 'library.list'
        && libraries.libraries.some((library) => library.libraryId === boundLibraryId);
      if (!libraryIsOpen) {
        if (pluginHostCommandRequiresBoundLibrary(commandId)) {
          throw new Error('The plugin command target library is not open.');
        }
        boundLibraryId = null;
      }
    }
    const executionId = context.targetLibraryId === undefined || boundLibraryId === null
      ? context.instanceId
      : `${context.instanceId}:${boundLibraryId}`;
    pluginAutomationContexts.set(executionId, {
      executionId,
      source: 'plugin',
      libraryId: boundLibraryId,
      grantedCapabilities: automationCapabilitiesFromPluginPermissions(context.permissions),
      pluginId: context.pluginId,
      pluginInstanceId: context.instanceId,
    });
    const commandInput = commandId === 'asset.search'
      ? normalizeAutomationAssetSearchInput(input)
      : input;
    if (commandInput === undefined) {
      throw new Error('Invalid search query.');
    }
    const result = await gateway.execute({
      apiVersion: AUTOMATION_API_VERSION,
      commandId,
      executionId,
      input: commandInput,
    });
    if (!result.ok) {
      // Serpent-8b5b.2: plugin host commands are never critical; a challenge
      // outcome is mapped defensively to a gateway failure.
      const failure = 'challenge' in result && result.challenge !== undefined
        ? { code: 'AUTOMATION_CHALLENGE_REQUIRED', message: 'Dangerous operation requires agent confirmation.' }
        : (result as { error: { code: string; message: string } }).error;
      state.logger?.error('plugin.host-command.gateway-failed', new Error(failure.message ?? failure.code), {
        instanceId: context.instanceId,
        pluginId: context.pluginId,
        commandId,
        errorCode: failure.code,
      });
      throw new PluginHostCommandError(failure.code, failure.message ?? failure.code);
    }
    return result.result;
  };
  const recordPluginRuntimeCrash = (crash: {
    instanceId: string;
    libraryId: string;
    libraryDirectory: string;
    pluginId: string;
    packageHash: string;
    failureCode: string;
  }): void => {
    state.pluginInputCaptureBroker?.releaseForInstance(crash.instanceId, 'plugin-crashed');
    void state.pluginPackageManager?.recordRuntimeCrash({
      libraryId: crash.libraryId,
      libraryDirectory: crash.libraryDirectory,
      pluginId: crash.pluginId,
      packageHash: crash.packageHash,
      failureCode: crash.failureCode,
    }).catch((error) => {
      state.logger?.error('plugin.runtime.crash-record', error, crash);
    });
  };
  const pluginStorageStore = new PluginStorageStore(app.getPath('userData'));
  const pluginSettingsStore = new PluginSettingsStore(app.getPath('userData'));
  const pluginMcpExposureStore = new PluginMcpExposureStore(app.getPath('userData'));
  await pluginMcpExposureStore.load();
  const executePluginStorage: PluginRuntimeStorageHandler = async (input) => {
    try {
      return await pluginStorageStore.execute({
        operation: input.operation,
        scope: input.scope ?? 'library',
        pluginId: input.context.pluginId,
        libraryId: input.context.libraryId,
        libraryDirectory: input.context.libraryDirectory,
        permissions: input.context.permissions,
        ...(input.key === undefined ? {} : { key: input.key }),
        ...(input.value === undefined ? {} : { value: input.value }),
      });
    } catch (error) {
      if (error instanceof PluginStorageStoreError) throw error;
      throw error;
    }
  };
  const resolvePluginJobTargetLibrary = async (input: {
    instanceId: string;
    requestedTargetLibraryId?: string;
    ambientLibraryId: string;
  }): Promise<{ record: NonNullable<ReturnType<PluginActivationCoordinator['findActiveInstance']>>; libraryId: string }> => {
    const coordinator = state.pluginActivationCoordinator;
    const client = state.workerClient;
    if (coordinator === undefined || client === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const record = coordinator.findActiveInstance(input.instanceId);
    if (record === undefined) {
      throw Object.assign(new Error('The plugin instance is no longer active.'), { code: 'INSTANCE_GONE' });
    }
    if (record.instanceScope === 'global' && input.requestedTargetLibraryId === undefined) {
      throw Object.assign(
        new Error('Global plugin jobs require an explicit open target library.'),
        { code: 'JOB_TARGET_REQUIRED' },
      );
    }
    const candidate = input.requestedTargetLibraryId ?? input.ambientLibraryId;
    const parsedTarget = pluginTargetLibraryIdSchema.safeParse(candidate);
    if (!parsedTarget.success) {
      throw Object.assign(new Error('The plugin job target library is invalid.'), { code: 'JOB_TARGET_INVALID' });
    }
    if (record.instanceScope === 'library' && record.activationLibraryId !== parsedTarget.data) {
      throw Object.assign(
        new Error('A library-scoped plugin cannot target another library.'),
        { code: 'JOB_TARGET_SCOPE_VIOLATION' },
      );
    }
    const libraries = await client.request({ type: 'library.list' });
    if (!libraries.ok || libraries.type !== 'library.list'
      || !libraries.libraries.some((library) => library.libraryId === parsedTarget.data)) {
      throw Object.assign(new Error('The plugin job target library is not open.'), { code: 'JOB_TARGET_NOT_OPEN' });
    }
    return { record, libraryId: parsedTarget.data };
  };
  const handlePluginJobEnqueue: PluginRuntimeJobEnqueueHandler = async (input) => {
    const client = state.workerClient;
    if (client === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const { record, libraryId } = await resolvePluginJobTargetLibrary({
      instanceId: input.instanceId,
      requestedTargetLibraryId: input.targetLibraryId,
      ambientLibraryId: input.context.libraryId,
    });
    const coordinator = state.pluginActivationCoordinator;
    if (coordinator === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const validated = coordinator.validateJobEnqueue({
      instanceId: input.instanceId,
      handlerId: input.handlerId,
      ...(input.recoveryStrategy === undefined ? {} : { recoveryStrategy: input.recoveryStrategy }),
    });
    if (!validated.ok) {
      throw Object.assign(new Error(validated.message), { code: validated.code });
    }
    const result = await client.request({
      type: 'plugin.jobs.enqueue',
      libraryId,
      ownerPluginId: input.context.pluginId,
      ownerPackageHash: input.context.packageHash,
      ownerPluginInstanceId: input.instanceId,
      ownerScope: record.instanceScope,
      ownerLibraryId: libraryId,
      pluginHandlerId: input.handlerId,
      payload: input.payload,
      recoveryStrategy: validated.recoveryStrategy,
    });
    if (!result.ok || result.type !== 'plugin.jobs.enqueued') {
      throw Object.assign(
        new Error(result.ok ? 'Plugin job enqueue returned an unexpected result.' : result.error.reason),
        { code: result.ok ? 'JOB_ENQUEUE_FAILED' : result.error.code },
      );
    }
    state.pluginJobScheduler?.tick(libraryId);
    return { jobId: result.job.jobId };
  };
  const handlePluginJobProgress: PluginRuntimeJobProgressHandler = async (input) => {
    const client = state.workerClient;
    if (client === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const { record, libraryId: targetLibraryId } = await resolvePluginJobTargetLibrary({
      instanceId: input.instanceId,
      requestedTargetLibraryId: input.targetLibraryId,
      ambientLibraryId: input.context.libraryId,
    });
    const result = await client.request({
      type: 'plugin.jobs.report-progress',
      libraryId: targetLibraryId,
      jobId: input.jobId,
      ownerPluginId: input.context.pluginId,
      ownerPackageHash: input.context.packageHash,
      ownerPluginInstanceId: input.instanceId,
      ownerScope: record.instanceScope,
      ownerLibraryId: targetLibraryId,
      ...input.progress,
    });
    if (!result.ok || result.type !== 'plugin.jobs.completed') {
      throw Object.assign(
        new Error(result.ok ? 'Plugin job progress returned an unexpected result.' : result.error.reason),
        { code: result.ok ? 'JOB_PROGRESS_FAILED' : result.error.code },
      );
    }
  };
  const handlePluginJobControl: PluginRuntimeJobControlHandler = async (input) => {
    const client = state.workerClient;
    const coordinator = state.pluginActivationCoordinator;
    if (client === undefined || coordinator === undefined) {
      throw Object.assign(new Error('Plugin jobs are unavailable in this session.'), { code: 'JOBS_UNAVAILABLE' });
    }
    const { record, libraryId } = await resolvePluginJobTargetLibrary({
      instanceId: input.instanceId,
      requestedTargetLibraryId: input.targetLibraryId,
      ambientLibraryId: input.context.libraryId,
    });
    const listed = await client.request({ type: 'plugin.jobs.list', libraryId });
    if (!listed.ok || listed.type !== 'plugin.jobs.listed') {
      throw Object.assign(new Error('The plugin job list could not be read.'), { code: 'JOB_LIST_FAILED' });
    }
    const job = listed.jobs.find((candidate) => candidate.jobId === input.jobId);
    const owner = {
      pluginId: record.pluginId,
      packageHash: record.packageHash,
      pluginInstanceId: record.instanceId,
      scope: record.instanceScope,
      libraryId,
    } as const;
    const ownsJob = job !== undefined && (input.action === 'retry'
      ? pluginJobOwnerCanRetry(job, owner)
      : pluginJobOwnerMatches(job, owner));
    if (!ownsJob) {
      throw Object.assign(new Error('The plugin does not own this job.'), { code: 'JOB_OWNERSHIP_MISMATCH' });
    }
    const capabilities = {
      handlerId: job.pluginHandlerId,
      resumable: job.recoveryStrategy === 'checkpoint',
      ...(job.checkpoint?.version === undefined ? { checkpointVersion: 'v1' } : { checkpointVersion: job.checkpoint.version }),
    } as const;
    const requestOwner = {
      ownerPluginId: record.pluginId,
      ownerPackageHash: record.packageHash,
      ownerPluginInstanceId: record.instanceId,
      ownerScope: record.instanceScope,
      ownerLibraryId: libraryId,
    } as const;
    let result: Awaited<ReturnType<typeof client.request>>;
    switch (input.action) {
      case 'cancel':
        result = await client.request({ type: 'plugin.jobs.cancel', libraryId, jobId: input.jobId, ...requestOwner, reason: input.reason });
        break;
      case 'pause':
        if (input.checkpoint === undefined) {
          throw Object.assign(new Error('Pausing a plugin job requires a checkpoint.'), { code: 'CHECKPOINT_REQUIRED' });
        }
        result = await client.request({
          type: 'plugin.jobs.pause', libraryId, jobId: input.jobId, ...requestOwner,
          capabilities,
          checkpoint: input.checkpoint,
        });
        break;
      case 'resume':
        result = await client.request({ type: 'plugin.jobs.resume', libraryId, jobId: input.jobId, ...requestOwner, capabilities });
        break;
      case 'retry':
        result = await client.request({ type: 'plugin.jobs.retry', libraryId, jobId: input.jobId, ...requestOwner, retryInput: input.retryInput });
        break;
    }
    if (!result.ok || !('job' in result)) {
      throw Object.assign(new Error(result.ok ? 'Plugin job control returned an unexpected result.' : result.error.reason), {
        code: result.ok ? 'JOB_CONTROL_FAILED' : result.error.code,
      });
    }
    if ((input.action === 'cancel' || input.action === 'pause') && result.job !== null) {
      if (record.mode === 'restricted') state.pluginRuntimeSupervisor?.signalJob(record.instanceId, input.jobId, input.action, input.reason);
      else state.pluginTrustedRuntimeSupervisor?.signalJob(record.instanceId, input.jobId, input.action, input.reason);
    }
    if (input.action === 'resume' || input.action === 'retry') state.pluginJobScheduler?.tick(libraryId);
    return { job: result.job };
  };
  const onPluginInstanceActivated = (input: { libraryId: string }): void => {
    state.pluginJobScheduler?.tick(input.libraryId);
  };
  const handlePluginInputCaptureStart: PluginRuntimeInputCaptureStartHandler = (input) => {
    if (state.pluginInputCaptureBroker === undefined) {
      return {
        ok: false,
        code: 'CAPTURE_UNAVAILABLE',
        message: 'Input capture is unavailable in this session.',
      };
    }
    return state.pluginInputCaptureBroker.start({
      ...input.options,
      instanceId: input.instanceId,
      pluginId: input.pluginId,
      libraryId: input.libraryId,
      permissions: input.permissions,
    });
  };
  state.pluginInputCaptureBroker = new PluginInputCaptureBroker({
    onStart: () => {
      publishPluginInputCaptureSessionsToRenderer();
    },
    onEvent: (session, event) => {
      state.pluginRuntimeSupervisor?.deliverInputCaptureEvent(session.instanceId, session.sessionId, event);
      state.pluginTrustedRuntimeSupervisor?.deliverInputCaptureEvent(session.instanceId, session.sessionId, event);
    },
    onEnd: (session, reason) => {
      state.pluginRuntimeSupervisor?.endInputCapture(session.instanceId, session.sessionId, reason);
      state.pluginTrustedRuntimeSupervisor?.endInputCapture(session.instanceId, session.sessionId, reason);
      publishPluginInputCaptureSessionsToRenderer();
    },
  });
  state.pluginRuntimeSupervisor = new PluginRuntimeSupervisor({
    modulePath: path.join(__dirname, 'plugin_standard_host.js'),
    fork: (modulePath) => utilityProcess.fork(modulePath, [], {
      serviceName: 'Keel Plugin Standard Host',
      stdio: 'pipe',
    }),
    executeHostCommand: executePluginHostCommand,
    executeStorage: executePluginStorage,
    handleJobEnqueue: handlePluginJobEnqueue,
    handleJobProgress: handlePluginJobProgress,
    handleJobControl: handlePluginJobControl,
    handleInputCaptureStart: handlePluginInputCaptureStart,
    handleInputCaptureRelease: (instanceId, sessionId) => {
      state.pluginInputCaptureBroker?.release(sessionId);
    },
    onInstanceDeactivated: (instanceId) => {
      state.pluginInputCaptureBroker?.releaseForInstance(instanceId, 'plugin-deactivated');
    },
    onInstanceCrashed: ({ instanceId, failureCode }) => {
      state.pluginActivationCoordinator?.onInstanceCrashed({ instanceId, failureCode });
    },
    onCrash: recordPluginRuntimeCrash,
    onInstanceActivated: onPluginInstanceActivated,
    logger: state.logger,
  });
  state.pluginTrustedRuntimeSupervisor = new PluginTrustedRuntimeSupervisor({
    modulePath: path.join(__dirname, 'plugin_trusted_host.js'),
    fork: (modulePath) => utilityProcess.fork(modulePath, [], {
      serviceName: 'Keel Plugin Trusted Host',
      stdio: 'pipe',
    }),
    executeHostCommand: executePluginHostCommand,
    executeStorage: executePluginStorage,
    handleJobEnqueue: handlePluginJobEnqueue,
    handleJobProgress: handlePluginJobProgress,
    handleJobControl: handlePluginJobControl,
    handleInputCaptureStart: handlePluginInputCaptureStart,
    handleInputCaptureRelease: (instanceId, sessionId) => {
      state.pluginInputCaptureBroker?.release(sessionId);
    },
    onInstanceDeactivated: (instanceId) => {
      state.pluginInputCaptureBroker?.releaseForInstance(instanceId, 'plugin-deactivated');
    },
    onInstanceCrashed: ({ instanceId, failureCode }) => {
      state.pluginActivationCoordinator?.onInstanceCrashed({ instanceId, failureCode });
    },
    onInstanceActivated: onPluginInstanceActivated,
    onCrash: recordPluginRuntimeCrash,
    logger: state.logger,
  });
  const pluginCompatibility = currentPluginCompatibilityPlatform();
  const nodeAbi = Number(process.versions.modules);
  if (pluginCompatibility === undefined || !Number.isSafeInteger(nodeAbi) || nodeAbi <= 0) {
    state.logger.error('plugin.platform', new Error('This platform cannot run the plugin package manager.'), {
      platform: process.platform,
      arch: process.arch,
      nodeAbi: process.versions.modules,
    });
  } else {
    state.pluginPackageManager = new PluginPackageManager({
      userDataDirectory: app.getPath('userData'),
      deviceId: await loadOrCreatePluginDeviceId(app.getPath('userData')),
      keelVersion: app.getVersion(),
      pluginApiVersion: PLUGIN_API_VERSION,
      ...pluginCompatibility,
      nodeAbi,
      logger: state.logger,
      onDeviceStateRecovered: () => {
        state.pendingPluginDeviceStateRecoveryNotice = true;
      },
    });
    state.pluginActivationCoordinator = new PluginActivationCoordinator({
      packageManager: state.pluginPackageManager,
      supervisor: state.pluginRuntimeSupervisor,
      trustedSupervisor: state.pluginTrustedRuntimeSupervisor,
      globalRuntimeContext: {
        libraryId: '__serpent_global_runtime__',
        libraryDirectory: app.getPath('userData'),
      },
      contributions: createContributionRegistry(),
      providers: createPluginProviderRegistry(),
      compatibility: {
        keelVersion: app.getVersion(),
        pluginApiVersion: PLUGIN_API_VERSION,
        ...pluginCompatibility,
        nodeAbi,
      },
      pausePluginJobs: async ({ libraryId, owners }) => {
        const client = state.workerClient;
        if (client === undefined) return;
        const result = await client.request({
          type: 'plugin.jobs.pause-owners',
          libraryId,
          owners,
          errorCode: 'PLUGIN_INSTANCE_INACTIVE',
          errorDetail: 'The plugin instance is no longer active.',
        });
        if (!result.ok) {
          throw new Error(result.error.reason);
        }
      },
      onInstanceActivated: ({ libraryId }) => {
        state.pluginJobScheduler?.tick(libraryId);
      },
      onContributionsRegistered: ({ libraryId }) => {
        void state.pluginProviderScheduler?.materializeLibrary(libraryId).catch((error) => {
          state.logger?.error('plugin.providers.materialize', error, { libraryId });
        });
        state.embeddedMcpServer?.notifyToolsChanged();
        void syncPluginThumbnailExtensions().catch((error) => {
          state.logger?.error('plugin.thumbnail-extensions', error, { libraryId });
        });
      },
      onProvidersChanged: () => {
        void syncPluginThumbnailExtensions().catch((error) => {
          state.logger?.error('plugin.thumbnail-extensions', error);
        });
      },
      logger: state.logger,
    });
    state.pluginMcpToolProvider = new PluginMcpToolProvider({
      activationCoordinator: state.pluginActivationCoordinator,
      exposureStore: pluginMcpExposureStore,
    });
    state.pluginJobScheduler = new PluginJobScheduler({
      supervisor: state.pluginRuntimeSupervisor,
      trustedSupervisor: state.pluginTrustedRuntimeSupervisor,
      requestWorker: async (command) => {
        const client = state.workerClient;
        if (client === undefined) return { ok: false };
        const result = await client.request(command);
        if (!result.ok) return { ok: false };
        if (result.type === 'plugin.jobs.claimed') {
          return { ok: true, type: result.type, job: result.job };
        }
        if (result.type === 'plugin.jobs.completed') {
          return { ok: true, type: result.type, job: result.job };
        }
        return { ok: false };
      },
      resolveInstances: (libraryId) => {
        const coordinator = state.pluginActivationCoordinator;
        if (coordinator === undefined) return [];
        const bindings = coordinator.listActiveInstances(libraryId);
        const standard = state.pluginRuntimeSupervisor?.listActiveInstances(libraryId) ?? [];
        const trusted = state.pluginTrustedRuntimeSupervisor?.listActiveInstances(libraryId) ?? [];
        return bindings.map((binding) => {
          const source = binding.mode === 'restricted'
            ? standard.find((item) => item.instanceId === binding.instanceId)
            : trusted.find((item) => item.instanceId === binding.instanceId);
          return {
            ...binding,
            activated: source?.activated ?? false,
          };
        });
      },
      logger: state.logger,
    });
    state.pluginProviderScheduler = new PluginProviderScheduler({
      coordinator: state.pluginActivationCoordinator,
      supervisor: state.pluginRuntimeSupervisor,
      trustedSupervisor: state.pluginTrustedRuntimeSupervisor,
      requestWorker: async (command) => {
        const client = state.workerClient;
        if (client === undefined) return { ok: false };
        const result = await client.request(command);
        if (!result.ok) return { ok: false };
        if (result.type === 'asset.list') {
          return { ok: true, type: result.type, assets: result.assets };
        }
        if (result.type === 'plugin.derived-fields.materialized') {
          return {
            ok: true,
            type: result.type,
            writtenCount: result.writtenCount,
            fieldKey: result.fieldKey,
          };
        }
        if (result.type === 'asset.search.result') {
          return {
            ok: true,
            type: result.type,
            items: result.items,
            total: result.total,
            offset: result.offset,
            snippets: result.snippets,
          };
        }
        return { ok: false };
      },
      logger: state.logger,
    });
    state.workerClient.onPluginMediaProviderRequest(async (input) => {
      const scheduler = state.pluginProviderScheduler;
      if (scheduler === undefined) {
        return {
          status: 'native-fallback',
          assetId: input.assetId,
          kind: input.kind,
          errorCode: 'PLUGIN_PROVIDER_UNAVAILABLE',
        };
      }
      try {
        return await scheduler.resolveMediaProvider(input);
      } catch (error) {
        state.logger?.error('plugin.media-provider.request', error, {
          libraryId: input.libraryId,
          assetId: input.assetId,
          kind: input.kind,
        });
        return {
          status: 'native-fallback',
          assetId: input.assetId,
          kind: input.kind,
          errorCode: 'PLUGIN_PROVIDER_FAILED',
        };
      }
    });
  }
  if (!state.automationExecutionJournal || !state.automationCommandGateway || !state.workerClient || !state.logger) {
    throw new Error('Embedded MCP server requires journal, gateway, worker, and logger.');
  }
  try {
    state.embeddedMcpServer = new EmbeddedMcpServer({
      userDataPath: app.getPath('userData'),
      journal: state.automationExecutionJournal,
      gateway: state.automationCommandGateway,
      workerClient: state.workerClient,
      logger: state.logger,
      getPluginTools: () => state.pluginMcpToolProvider,
      getHostTools: () => ruleMcpTools,
      permissionPolicyStore: state.mcpPermissionPolicyStore,
      permissionBroker: state.mcpPermissionBroker,
      // Serpent-fmbr: MCP operations speak through the SAME human-facing toasts
      // as manual operations — the renderer composes them from the structured
      // result. No separate "MCP client completed X" notification system.
      onCommandCompleted: ({ commandId, result }) => {
        if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
        state.mainWindow.webContents.send(COMMAND_COMPLETED_CHANNEL, { commandId, result });
      },
    });
    state.embeddedMcpServer.onSnapshot((snapshot) => {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        const validatedSnapshot = mcpSettingsSnapshotSchema.parse(snapshot);
        state.mainWindow.webContents.send(MCP_SETTINGS_EVENT_CHANNEL, validatedSnapshot);
      }
    });
  } catch (error) {
    // Keel review: an unrecoverable MCP construction failure (e.g. the
    // credential pepper ACL cannot be restricted on Windows) must disable the
    // MCP service, never the whole app — the settings IPC answers
    // MCP_SETTINGS_UNAVAILABLE while embeddedMcpServer stays undefined.
    state.embeddedMcpInitializationFailure = error instanceof McpCredentialStoreError ? error : undefined;
    state.logger?.error('mcp.embedded-server.construction-failed', error);
  }
  return { pluginStorageStore, pluginSettingsStore, pluginMcpExposureStore };
}
