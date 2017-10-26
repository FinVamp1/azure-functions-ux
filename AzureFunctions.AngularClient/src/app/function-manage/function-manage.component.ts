import { ConfigService } from './../shared/services/config.service';
import { Component } from '@angular/core';
import { Subject } from 'rxjs/Subject';
import 'rxjs/add/operator/do';
import 'rxjs/add/operator/retry';
import 'rxjs/add/operator/switchMap';
import 'rxjs/add/observable/zip';
import { TranslateService } from '@ngx-translate/core';

import { FunctionInfo } from '../shared/models/function-info';
import { SelectOption } from '../shared/models/select-option';
import { PortalService } from '../shared/services/portal.service';
import { GlobalStateService } from '../shared/services/global-state.service';
import { PortalResources } from '../shared/models/portal-resources';
import { FunctionApp } from '../shared/function-app';
import { TreeViewInfo } from '../tree-view/models/tree-view-info';
import { FunctionManageNode } from '../tree-view/function-node';
import { BindingManager } from '../shared/models/binding-manager';
import { FunctionGeneration } from '../shared/models/functions-version-info';
import { ErrorIds } from './../shared/models/error-ids';
import { ErrorType, ErrorEvent } from 'app/shared/models/error-event';
import { BroadcastEvent } from 'app/shared/models/broadcast-event';
import { BroadcastService } from './../shared/services/broadcast.service';
import { AiService } from './../shared/services/ai.service';

@Component({
    selector: 'function-manage',
    templateUrl: './function-manage.component.html',
    styleUrls: ['./function-manage.component.css'],
    inputs: ['viewInfoInput']
})
export class FunctionManageComponent {
    public functionStatusOptions: SelectOption<boolean>[];
    public functionInfo: FunctionInfo;
    public functionApp: FunctionApp;
    public isStandalone: boolean;
    public isHttpFunction = false;
    public gen: FunctionGeneration = null;

    private _viewInfoStream: Subject<TreeViewInfo<any>>;
    private _functionNode: FunctionManageNode;
    private functionStateValueChange: Subject<boolean>;

    constructor(private _portalService: PortalService,
        private _globalStateService: GlobalStateService,
        private _translateService: TranslateService,
        private _broadcastService: BroadcastService,
        configService: ConfigService,
        private _aiService: AiService) {

        this.isStandalone = configService.isStandalone();

        this._viewInfoStream = new Subject<TreeViewInfo<any>>();
        this._viewInfoStream
            .switchMap(viewInfo => {
                this._globalStateService.setBusyState();
                this._functionNode = <FunctionManageNode>viewInfo.node;
                this.functionInfo = this._functionNode.functionInfo;
                this.functionApp = this.functionInfo.functionApp;
                this.isHttpFunction = BindingManager.isHttpFunction(this.functionInfo);
                return this.functionApp.getRuntimeGeneration();
            })
            .do(null, e => {
                this._aiService.trackException(e, '/errors/function-manage');
                console.error(e);
            })
            .retry()
            .subscribe((r: FunctionGeneration) => {
                this._globalStateService.clearBusyState();
                this.gen = r;
            });


        this.functionStatusOptions = [
            {
                displayLabel: this._translateService.instant(PortalResources.enabled),
                value: false
            }, {
                displayLabel: this._translateService.instant(PortalResources.disabled),
                value: true
            }];

        this.functionStateValueChange = new Subject<boolean>();
        this.functionStateValueChange
            .switchMap(state => {
                this.functionInfo.config.disabled = state;
                this._globalStateService.setBusyState();
                this.functionInfo.config.disabled
                    ? this._portalService.logAction('function-manage', 'disable')
                    : this._portalService.logAction('function-manage', 'enable');
                return (this.gen === FunctionGeneration.V2) ? this.functionApp.updateDisabledAppSettings([this.functionInfo])
                    : this.functionApp.updateFunction(this.functionInfo);
            })
            .do(null, (e) => {
                this.functionInfo.config.disabled = !this.functionInfo.config.disabled;
                this._globalStateService.clearBusyState();
                this._broadcastService.broadcast<ErrorEvent>(BroadcastEvent.Error, {
                    message: this._translateService.instant(PortalResources.failedToSwitchFunctionState, 
                        { state: !this.functionInfo.config.disabled, functionName: this.functionInfo.name }),
                    errorId: ErrorIds.failedToSwitchEnabledFunction,
                    errorType: ErrorType.UserError,
                    resourceId: this.functionApp.site.id
                });
                console.error(e);
            })
            .retry()
            .subscribe(() => {
                this._globalStateService.clearBusyState();
            });
    }

    set viewInfoInput(viewInfo: TreeViewInfo<any>) {
        this._viewInfoStream.next(viewInfo);
    }

    deleteFunction() {
        const result = confirm(this._translateService.instant(PortalResources.functionManage_areYouSure, { name: this.functionInfo.name }));
        if (result) {
            this._globalStateService.setBusyState();
            this._portalService.logAction('function-manage', 'delete');
            // Clone node for removing as it can be change during http call
            const clone = Object.create(this._functionNode);
            this.functionApp.deleteFunction(this.functionInfo)
                .subscribe(() => {
                    clone.remove();
                    // this._broadcastService.broadcast(BroadcastEvent.FunctionDeleted, this.functionInfo);
                    this._globalStateService.clearBusyState();
                });
        }
    }
}
