export interface FunctionsVersionInfo {
    runtimeStable: string[];
    runtimeDefault: string;
}

export enum FunctionGeneration {
    V1,
    V2
}

export class FunctionsVersionInfoHelper {

    public static needToUpdateRuntime(version: FunctionsVersionInfo, extensionVersion: string) {
        const match = version.runtimeStable.find(v => {
            return extensionVersion.toLowerCase() === v;
        });
        return !match;
    }

    public static getFuntionGeneration(runtimeVersion: string) {
        return (runtimeVersion.startsWith('~2')
            || runtimeVersion.startsWith('2')
            || runtimeVersion.startsWith('beta')) ? FunctionGeneration.V2 : FunctionGeneration.V1;
    }
}
