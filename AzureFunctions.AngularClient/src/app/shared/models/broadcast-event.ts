import { DashboardType } from 'app/tree-view/models/dashboard-type';
export enum BroadcastEvent {
    TreeNavigation,
    TreeUpdate,
    FunctionDeleted,
    FunctionAdded,
    FunctionSelected,
    FunctionUpdated,
    // FunctionNew,
    UpdateBusyState,
    TutorialStep,
    IntegrateChanged,
    Error,
    VersionUpdated,
    TrialExpired,
    ResetKeySelection,
    RefreshPortal,
    ClearError,
    OpenTab,
    DirtyStateChange,
    UpdateAppsList
}

export interface DirtyStateEvent {
    dirty: boolean;
    reason: string | null;
}

export interface BusyStateEvent{
    busyComponentName: string;
    action: 'setBusyState' | 'clearBusyState' | 'clearOverallBusyState';
    busyStateKey: string;
}

export interface TreeUpdateEvent{
    operation: 'add' | 'delete' | 'update';
    dashboardType: DashboardType;
    resourceId: string;
    data?: any;
}