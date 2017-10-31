import { HostingEnvironment } from './../models/arm/hosting-environment';
import { SiteService } from './slots.service';
import { FunctionAppEditMode } from 'app/shared/models/function-app-edit-mode';
import { SiteConfig } from './../models/arm/site-config';
import { PortalResources } from './../models/portal-resources';
import { BroadcastEvent } from 'app/shared/models/broadcast-event';
import { TranslateService } from '@ngx-translate/core';
import { AiService } from 'app/shared/services/ai.service';
import { NoCorsHttpService } from './../no-cors-http-service';
import { BroadcastService } from './broadcast.service';
import { GlobalStateService } from './global-state.service';
import { FunctionAppContext } from './functions-service';
import { Observable } from 'rxjs/Observable';
import { UserService } from './user.service';
import { FunctionsResponse } from './../models/functions-response';
import { ArmUtil } from 'app/shared/Utilities/arm-utils';
import { ConfigService } from './config.service';
import { Site } from './../models/arm/site';
import { ArmObj } from './../models/arm/arm-obj';
import { FunctionInfo } from './../models/function-info';
import { CacheService } from 'app/shared/services/cache.service';
import { Injectable } from '@angular/core';
import { UrlTemplates } from 'app/shared/url-templates';
import { Http, Headers, Response } from '@angular/http';
import { ErrorIds } from '../models/error-ids';
import { ErrorEvent, ErrorType } from '../models/error-event';
import { Constants } from 'app/shared/models/constants';

export interface FunctionAppContext {
    site: ArmObj<Site>;
    scmUrl: string;
    mainSiteUrl: string;
    urlTemplates: UrlTemplates;
    tryFunctionsScmCreds?: string;
    masterKey?: string;
}

@Injectable()
export class FunctionsService {
    private _token: string;

    private _http: NoCorsHttpService;

    constructor(
        private _cacheService: CacheService,
        private _configService: ConfigService,
        private _userService: UserService,
        private _globalStateService: GlobalStateService,
        private _broadcastService: BroadcastService,
        private _ngHttp: Http,
        private _aiService: AiService,
        private _translateService: TranslateService,
        private _siteService: SiteService) {

        this._http = new NoCorsHttpService(this._ngHttp, this._broadcastService, this._aiService, this._translateService, () => this._getPortalHeaders());

        this._userService.getStartupInfo()
            .subscribe(info => {
                this._token = info.token;
            });
    }

    getAppContext(resourceId: string): Observable<FunctionAppContext> {
        return this._cacheService.getArm(resourceId)
            .map(r => {
                const site: ArmObj<Site> = r.json();
                const scmUrl = this.getScmUrl(site);
                const mainSiteUrl = this.getMainUrl(site);

                const context: FunctionAppContext = {
                    site: site,
                    scmUrl: scmUrl,
                    mainSiteUrl: mainSiteUrl,
                    urlTemplates: new UrlTemplates(scmUrl, mainSiteUrl, ArmUtil.isLinuxApp(site))
                };

                return context;
            });
    }

    getFunctions(context: FunctionAppContext) {
        let fcs: FunctionInfo[];

        return this._cacheService.get(context.urlTemplates.functionsUrl, false, this._getScmSiteHeaders(context))
            .catch(() => this._http.get(context.urlTemplates.functionsUrl, { headers: this._getScmSiteHeaders(context) }))
            .retryWhen(this.retryAntares)
            .map((r: Response) => {
                try {
                    fcs = r.json() as FunctionInfo[];
                    // fcs.forEach(fc => fc.functionApp = this);
                    fcs.forEach(fc => fc.context = context);
                    return fcs;
                } catch (e) {
                    // We have seen this happen when kudu was returning JSON that contained
                    // comments because Json.NET is okay with comments in the JSON file.
                    // We can't parse that JSON in browser, so this is just to handle the error correctly.
                    this._broadcastService.broadcast<ErrorEvent>(BroadcastEvent.Error, {
                        message: this._translateService.instant(PortalResources.error_parsingFunctionListReturenedFromKudu),
                        errorId: ErrorIds.deserializingKudusFunctionList,
                        errorType: ErrorType.Fatal,
                        resourceId: context.site.id
                    });
                    this.trackEvent(context, ErrorIds.deserializingKudusFunctionList, {
                        error: e,
                        content: r.text(),
                    });
                    return <FunctionInfo[]>[];
                }
            })
            .do(() => this._broadcastService.broadcast<string>(BroadcastEvent.ClearError, ErrorIds.unableToRetrieveFunctionsList),
            (error: FunctionsResponse) => {
                if (!error.isHandled) {
                    this._broadcastService.broadcast<ErrorEvent>(BroadcastEvent.Error, {
                        message: this._translateService.instant(PortalResources.error_unableToRetrieveFunctionListFromKudu),
                        errorId: ErrorIds.unableToRetrieveFunctionsList,
                        errorType: ErrorType.RuntimeError,
                        resourceId: context.site.id
                    });
                    this.trackEvent(context, ErrorIds.unableToRetrieveFunctionsList, {
                        content: error.text(),
                        status: error.status.toString()
                    });
                }
            });
    }

    getScmUrl(site: ArmObj<Site>) {
        if (this._configService.isStandalone()) {
            return this.getMainUrl(site);
        } else {
            return `https://${site.properties.hostNameSslStates.find(s => s.hostType === 1).name}`;
        }
    }

    getMainUrl(site: ArmObj<Site>) {
        if (this._configService.isStandalone()) {
            return `https://${site.properties.defaultHostName}/functions/${site.name}`;
        } else {
            return `https://${site.properties.defaultHostName}`;
        }
    }

    // private _editModeSubject: Subject<FunctionAppEditMode>;
    getFunctionAppEditMode(context: FunctionAppContext): Observable<FunctionAppEditMode> {
        // The we have 2 settings to check here. There is the SourceControl setting which comes from /config/web
        // and there is FUNCTION_APP_EDIT_MODE which comes from app settings.
        // editMode (true -> readWrite, false -> readOnly)
        // Table
        // |Slots | SourceControl | AppSettingValue | EditMode                      |
        // |------|---------------|-----------------|-------------------------------|
        // | No   | true          | readWrite       | ReadWriteSourceControlled     |
        // | No   | true          | readOnly        | ReadOnlySourceControlled      |
        // | No   | true          | undefined       | ReadOnlySourceControlled      |
        // | No   | false         | readWrite       | ReadWrite                     |
        // | No   | false         | readOnly        | ReadOnly                      |
        // | No   | false         | undefined       | ReadWrite                     |

        // | Yes  | true          | readWrite       | ReadWriteSourceControlled     |
        // | Yes  | true          | readOnly        | ReadOnlySourceControlled      |
        // | Yes  | true          | undefined       | ReadOnlySourceControlled      |
        // | Yes  | false         | readWrite       | ReadWrite                     |
        // | Yes  | false         | readOnly        | ReadOnly                      |
        // | Yes  | false         | undefined       | ReadOnlySlots                 |
        // |______|_______________|_________________|_______________________________|
        // if (!this._editModeSubject) {
        //     this._editModeSubject = new Subject<FunctionAppEditMode>();
        // }

        return Observable.zip(
            this._checkIfSourceControlEnabled(context.site),
            this._cacheService.postArm(`${context.site.id}/config/appsettings/list`, true),
            SiteService.isSlot(context.site.id)
                ? Observable.of(true)
                : this._siteService.getSlotsList(context.site.id).map(r => r.length > 0),
            this.getFunctions(context),
            (a, b, s, f: FunctionInfo[]) => ({ sourceControlEnabled: a, appSettingsResponse: b, hasSlots: s, functions: f })
        )
            .map(result => {
                const appSettings: ArmObj<any> = result.appSettingsResponse.json();
                const sourceControlled = result.sourceControlEnabled;

                let editModeSettingString: string = appSettings.properties[Constants.functionAppEditModeSettingName] || '';
                editModeSettingString = editModeSettingString.toLocaleLowerCase();
                const vsCreatedFunc = result.functions.find((fc: any) => !!fc.config.generatedBy);
                if (vsCreatedFunc) {
                    return FunctionAppEditMode.ReadOnlyVSGenerated;
                }
                if (editModeSettingString === Constants.ReadWriteMode) {
                    return sourceControlled ? FunctionAppEditMode.ReadWriteSourceControlled : FunctionAppEditMode.ReadWrite;
                } else if (editModeSettingString === Constants.ReadOnlyMode) {
                    return sourceControlled ? FunctionAppEditMode.ReadOnlySourceControlled : FunctionAppEditMode.ReadOnly;
                } else if (sourceControlled) {
                    return FunctionAppEditMode.ReadOnlySourceControlled;
                } else {
                    return result.hasSlots ? FunctionAppEditMode.ReadOnlySlots : FunctionAppEditMode.ReadWrite;
                }
            })
            .catch(() => Observable.of(FunctionAppEditMode.ReadWrite))
        // .subscribe(r => this._editModeSubject.next(r));

        // return this._editModeSubject;
    }

    reachableInternalLoadBalancerApp(context: FunctionAppContext, http: CacheService): Observable<boolean> {
        if (context && context.site &&
            context.site.properties.hostingEnvironmentProfile &&
            context.site.properties.hostingEnvironmentProfile.id) {
            return http.getArm(context.site.properties.hostingEnvironmentProfile.id, false, '2016-09-01')
                .mergeMap(r => {
                    const ase: ArmObj<HostingEnvironment> = r.json();
                    if (ase.properties.internalLoadBalancingMode &&
                        ase.properties.internalLoadBalancingMode !== 'None') {
                        return this.pingScmSite(context);
                    } else {
                        return Observable.of(true);
                    }
                });
        } else {
            return Observable.of(true);
        }
    }

    /**
     * This method just pings the root of the SCM site. It doesn't care about the response in anyway or use it.
     */
    pingScmSite(context: FunctionAppContext): Observable<boolean> {
        return this._http.get(context.urlTemplates.pingScmSiteUrl, { headers: this._getScmSiteHeaders(context) })
            .map(_ => true)
            .catch(() => Observable.of(false));
    }

    private _checkIfSourceControlEnabled(site: ArmObj<Site>): Observable<boolean> {
        return this._cacheService.getArm(`${site.id}/config/web`)
            .map(r => {
                const config: ArmObj<SiteConfig> = r.json();
                return !config.properties['scmType'] || config.properties['scmType'] !== 'None';
            })
            .catch(() => Observable.of(false));
    }

    // to talk to scm site
    private _getScmSiteHeaders(context: FunctionAppContext, contentType?: string): Headers {
        contentType = contentType || 'application/json';

        const headers = new Headers();
        headers.append('Content-Type', contentType);
        headers.append('Accept', 'application/json,*/*');
        if (!this._globalStateService.showTryView && this._token) {
            headers.append('Authorization', `Bearer ${this._token}`);
        }

        if (context.tryFunctionsScmCreds) {
            headers.append('Authorization', `Basic ${context.tryFunctionsScmCreds}`);
        }

        if (context.masterKey) {
            headers.append('x-functions-key', context.masterKey);
        }

        return headers;
    }

    // private _getMainSiteHeaders(contentType?: string): Headers {
    //     contentType = contentType || 'application/json';
    //     const headers = new Headers();
    //     headers.append('Content-Type', contentType);
    //     headers.append('Accept', 'application/json,*/*');
    //     headers.append('x-functions-key', this.masterKey);
    //     return headers;
    // }

    // to talk to Functions Portal
    private _getPortalHeaders(contentType?: string): Headers {
        contentType = contentType || 'application/json';
        const headers = new Headers();
        headers.append('Content-Type', contentType);
        headers.append('Accept', 'application/json,*/*');

        if (this._token) {
            headers.append('client-token', this._token);
            headers.append('portal-token', this._token);
        }

        return headers;
    }

    /**
     * This function is just a wrapper around AiService.trackEvent. It injects default params expected from this class.
     * Currently that's only scmUrl
     * @param params any additional parameters to get added to the default parameters that this class reports to AppInsights
     */
    private trackEvent(context: FunctionAppContext, name: string, params: { [name: string]: string }) {
        const standardParams = {
            scmUrl: context.urlTemplates.pingScmSiteUrl
        };

        for (const key in params) {
            if (params.hasOwnProperty(key)) {
                standardParams[key] = params[key];
            }
        }

        this._aiService.trackEvent(name, standardParams);
    }


    private retryAntares(error: Observable<any>): Observable<any> {
        return error.scan((errorCount: number, err: FunctionsResponse) => {
            if (err.isHandled || err.status < 500 || errorCount >= 10) {
                throw err;
            } else {
                return errorCount + 1;
            }
        }, 0).delay(1000);
    }
}