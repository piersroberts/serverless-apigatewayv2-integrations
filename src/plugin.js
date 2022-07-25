const OPENAPI_VERSION = "3.0.1";

const integrationTypes = {
  eventBridge: {
    name: "EventBridge",
    options: ["sourceName", "busName"],
  },
};

function createEventBridgeIntegration(prefix, sourceName, busName) {
  return {
    "x-amazon-apigateway-integration": {
      integrationSubtype: "EventBridge-PutEvents",
      credentials: { "Fn::GetAtt": [`${prefix}IamRole`, "Arn"] },
      requestParameters: {
        Detail: "$request.body.Detail",
        DetailType: "$request.body.DetailType",
        Source: sourceName,
        EventBusName: busName,
      },
      payloadFormatVersion: "1.0",
      type: "aws_proxy",
      connectionType: "INTERNET",
    },
  };
}

function createIntegration(type) {
  const integrationTypes = { EventBridge: createEventBridgeIntegration };
  return integrationTypes[type];
}

function createOpenApiBody(title, integration) {
  return {
    openapi: OPENAPI_VERSION,
    info: { version: "1", title: title },
    paths: {
      "/": {
        post: {
          responses: { default: { description: "Success" } },
          ...integration,
        },
      },
    },
  };
}

function createApiMapping(prefix, domainName, path) {
  return {
    Type: "AWS::ApiGatewayV2::ApiMapping",
    Properties: {
      DomainName: domainName,
      ApiMappingKey: path,
      ApiId: { Ref: `${prefix}ApiGatewayApi` },
      Stage: { Ref: `${prefix}ApiGatewayStage` },
    },
  };
}
function createApi(title, integration) {
  return {
    Type: "AWS::ApiGatewayV2::Api",
    Properties: {
      Body: createOpenApiBody(title, integration),
    },
  };
}
function createStage(prefix, stageName) {
  return {
    Type: "AWS::ApiGatewayV2::Stage",
    Properties: {
      ApiId: { Ref: `${prefix}ApiGatewayApi` },
      StageName: stageName,
      AutoDeploy: true,
    },
  };
}

function createEventBridgePolicy(busName) {
  return {
    PolicyName: "ApiDirectWriteEventBridge",
    PolicyDocument: {
      Version: "2012-10-17",
      Statement: {
        Action: ["events:PutEvents"],
        Effect: "Allow",
        Resource: [
          {
            "Fn::Join": [
              ":",
              [
                "arn",
                "aws",
                "events",
                { Ref: "AWS::Region" },
                { Ref: "AWS::AccountId" },
                `event-bus/${busName}`,
              ],
            ],
          },
        ],
      },
    },
  };
}

function createRole(policies) {
  return {
    Type: "AWS::IAM::Role",
    Properties: {
      AssumeRolePolicyDocument: {
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: {
              Service: "apigateway.amazonaws.com",
            },
            Action: ["sts:AssumeRole"],
          },
        ],
      },
      Policies: policies,
    },
  };
}

function getIntegrationType(config) {
  const integrationTypeKey = Object.keys(integrationTypes).find((key) =>
    Object.keys(config).includes(key)
  );

  return integrationTypes[integrationTypeKey];
}

export default class ApiGatewayIntegrationPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};
    this.provider = this.serverless.getProvider("aws");
    this.config =
      serverless.service.custom && this.serverless.service.custom.integrations
        ? this.serverless.service.custom.integrations
        : undefined;

    if (!this.config) {
      return;
    }

    this.hooks = {
      "package:compileEvents": () => this.doPackage(),
    };
  }

  doPackage() {
    const integrationType = getIntegrationType(this.config);
    if (!integrationType) {
      console.warn(
        `No integration type recognised, expecting one of [${Object.keys(
          integrationTypes
        ).join(",")}]`
      );
      return;
    }

    const template =
      this.serverless.service.provider.compiledCloudFormationTemplate;

    const stageName = this.serverless.service.provider.stage;

    const prefix = this.config.prefix;
    const domainName = this.config.domain;
    const path = this.config.path;
    const apiTitle = this.config.title;

    const busName = this.config.eventBridge.busName;
    const sourceName = this.config.eventBridge.sourceName;

    const rolePolicies = [createEventBridgePolicy(busName)];

    const openApiIntegration = createIntegration(integrationType.name)(
      prefix,
      sourceName,
      busName
    );

    template.Resources[`${prefix}ApiGatewayApiMapping`] = createApiMapping(
      prefix,
      domainName,
      path
    );
    template.Resources[`${prefix}ApiGatewayApi`] = createApi(
      apiTitle,
      openApiIntegration
    );
    template.Resources[`${prefix}ApiGatewayStage`] = createStage(
      prefix,
      stageName
    );
    template.Resources[`${prefix}IamRole`] = createRole(rolePolicies);

    const config = Object.fromEntries([[`${prefix}IamRole`, 1]]);

    console.log(this.serverless.service.provider);
  }
}
