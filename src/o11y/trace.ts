/* eslint-disable semi */
import { Span, Tracer } from '@opentelemetry/api';
import opentelemetry from '@opentelemetry/api';
import { logger } from '#o11y/logger';
import { SugaredTracer, wrapTracer } from './trace/SugaredTracer';

/**
 * Dummy tracer for when tracing is not enabled. As we use more trace methods we will need to fill out this stub further.
 */
const dummyTracer = {
	startSpan: () => {
		const span: Partial<Span> = {};
		span.end = () => undefined;
		span.setAttribute = () => span as Span;
		span.setAttributes = () => span as Span;
		span.recordException = () => undefined;
		span.setStatus = () => span as Span;
		span.addEvent = () => span as Span;
		return span;
	},
};

const fakeSpan = {
	end: () => {},
	setAttribute: () => fakeSpan,
	setAttributes: () => fakeSpan,
	recordException: () => undefined,
	setStatus: () => fakeSpan,
	addEvent: () => fakeSpan,
} as unknown as Span;

let tracer: SugaredTracer | null = null;

/**
 * @param {Tracer} theTracer - Tracer to be set by the trace-init service
 */
export function setTracer(theTracer: Tracer): void {
	tracer = wrapTracer(theTracer);
}

export function getTracer(): SugaredTracer | null {
	return tracer;
}

/**
 * Starts a new independent span. The returned span must have end() called on it.
 * Only use this if your work won’t create any sub-spans.
 * @see https://opentelemetry.io/docs/instrumentation/js/instrumentation/#create-independent-spans
 * @param spanName - The name of the span
 * @returns a new span
 */
export function startSpan(spanName: string): Span {
	return tracer?.startSpan(spanName) ?? <Span>(<unknown>dummyTracer.startSpan());
}

export function getActiveSpan(): Span | null {
	return opentelemetry.trace.getActiveSpan();
}

/**
 * Convenience wrapper which uses the appropriate tracer and always ends the parent span.
 * @see https://opentelemetry.io/docs/instrumentation/js/instrumentation/#create-spans
 * @param spanName - The name of the span
 * @param func - Function which performs the work in the span
 * @returns the value from work function
 */
export function withActiveSpan<T>(spanName: string, func: (span: Span) => T): T {
	if (!tracer) return func(fakeSpan);

	return tracer.withActiveSpan(spanName, func);
}

/**
 * Only use it if your function won’t create any sub-spans.
 * @param spanName
 * @param func
 */
export function withSpan<T>(spanName: string, func: (span: Span) => T): T {
	if (!tracer) return func(fakeSpan);

	return tracer.withSpan(spanName, func);
}

type SpanAttributeExtractor = number | ((...args: any) => string);
type SpanAttributeExtractors = Record<string, SpanAttributeExtractor>;

/**
 * Decorator for creating a span around a function, which can add the function arguments as
 * attributes to the span. The decorator argument object has the keys as the attribute names
 * and the values as either 1) the function args array index 2) a function which takes the args array as its one argument
 * e.g.
 * @spanWithArgAttributes({ bar: 0, baz: (args) => args[1].toSpanAttributeValue() })
 * public foo(bar: string, baz: ComplexType) {}
 *
 *
 * @param attributeExtractors
 * @returns
 */
export function span(attributeExtractors: SpanAttributeExtractors = {}) {
	// NOTE this has been copied to func() in functions.ts and modified
	// Any changes should be kept in sync
	return function spanDecorator(originalMethod: any, context: ClassMethodDecoratorContext): any {
		const functionName = String(context.name);
		return function replacementMethod(this: any, ...args: any[]) {
			if (!tracer) {
				return originalMethod.call(this, ...args);
			}
			return tracer.withSpan(functionName, (span: Span) => {
				setFunctionSpanAttributes(span, functionName, attributeExtractors, args);
				return originalMethod.call(this, ...args);
			});
		};
	};
}

export function setFunctionSpanAttributes(span: Span, functionName: string, attributeExtractors, args) {
	for (const [attribute, extractor] of Object.entries(attributeExtractors)) {
		if (typeof extractor === 'number') {
			const value = args[extractor] ?? '';
			// If value is an object type, then iterate over the entries and set the attributes for primitive types
			if (typeof value === 'object') {
				for (const [key, val] of Object.entries(value)) {
					if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
						span.setAttribute(`${attribute}.${key} ${val}`, val);
					}
				}
			} else {
				span.setAttribute(attribute, value);
			}
		} else if (typeof extractor === 'function') {
			span.setAttribute(attribute, extractor(...args));
		} else {
			logger.warn(`Invalid attribute extractor for ${functionName}() attribute[${attribute}], must be a number or function`);
		}
	}
}

/**
 * Decorator for creating a span around a function, which can add the function arguments as
 * attributes to the span. The decorator argument object has the keys as the attribute names
 * and the values as either 1) the function args array index 2) a function which takes the args array as its one argument
 * e.g.
 * @spanWithArgAttributes({ bar: 0, baz: (args) => args[1].toSpanAttributeValue() })
 * public foo(bar: string, baz: ComplexType) {}
 *
 *
 * @param attributeExtractors
 * @returns
 */
export function activeSpan(attributeExtractors: Record<string, number | ((...args: any) => string)> = {}) {
	// NOTE this has been copied to func() in functions.ts and modified
	// Any changes should be kept in sync
	return function spanDecorator(originalMethod: any, context: ClassMethodDecoratorContext): any {
		const functionName = String(context.name);
		return function replacementMethod(this: any, ...args: any[]) {
			if (!tracer) return originalMethod.call(this, ...args);

			return tracer.withActiveSpan(functionName, (span: Span) => {
				setFunctionSpanAttributes(span, functionName, attributeExtractors, args);
				return originalMethod.call(this, ...args);
			});
		};
	};
}
