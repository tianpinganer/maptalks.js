import { isNil, isNumber, isArrayHasData, getValueOrDefault, round } from 'core/util';
import { isGradient, getGradientStamp } from 'core/util/style';
import { hasFunctionDefinition } from 'core/mapbox';
import Point from 'geo/Point';
import PointExtent from 'geo/PointExtent';
import Canvas from 'core/Canvas';
import PointSymbolizer from './PointSymbolizer';

export default class VectorMarkerSymbolizer extends PointSymbolizer {

    static test(symbol) {
        if (!symbol) {
            return false;
        }
        if (isNil(symbol['markerFile']) && !isNil(symbol['markerType']) && (symbol['markerType'] !== 'path')) {
            return true;
        }
        return false;
    }

    constructor(symbol, geometry, painter) {
        super(symbol, geometry, painter);
        this._dynamic = hasFunctionDefinition(symbol);
        this.style = this._defineStyle(this.translate());
        this.strokeAndFill = this._defineStyle(VectorMarkerSymbolizer.translateLineAndFill(this.style));
        const lineWidth = this.strokeAndFill['lineWidth'];
        if (lineWidth % 2 === 0) {
            this.padding = [2, 2];
        } else {
            this.padding = [3, 3];
        }
    }

    symbolize(ctx, resources) {
        const style = this.style;
        if (style['markerWidth'] === 0 || style['markerHeight'] === 0 ||
            (style['polygonOpacity'] === 0 && style['lineOpacity'] === 0)) {
            return;
        }
        const cookedPoints = this._getRenderContainerPoints();
        if (!isArrayHasData(cookedPoints)) {
            return;
        }
        this._prepareContext(ctx);
        if (this.getPainter().isSpriting() ||
            this.geometry.getLayer().getMask() === this.geometry ||
            this._dynamic ||
            this.geometry.getLayer().options['cacheVectorOnCanvas'] === false) {
            this._drawMarkers(ctx, cookedPoints, resources);
        } else {
            this._drawMarkersWithCache(ctx, cookedPoints, resources);
        }

    }

    _drawMarkers(ctx, cookedPoints, resources) {

        const strokeAndFill = this.strokeAndFill;
        const gradient = isGradient(strokeAndFill['lineColor']) || isGradient(strokeAndFill['polygonFill']);
        if (!gradient) {
            Canvas.prepareCanvas(ctx, strokeAndFill, resources);
        }
        for (let i = cookedPoints.length - 1; i >= 0; i--) {
            let point = cookedPoints[i];
            const origin = this._rotate(ctx, point, this._getRotationAt(i));
            if (origin) {
                point = origin;
            }

            this._drawVectorMarker(ctx, point, resources);
            if (origin) {
                ctx.restore();
            }
        }
    }

    _drawMarkersWithCache(ctx, cookedPoints, resources) {
        const stamp = this._stampSymbol();
        let image = resources.getImage(stamp);
        if (!image) {
            image = this._createMarkerImage(ctx, resources);
            resources.addResource([stamp, image.width, image.height], image);
        }
        const anchor = this._getAnchor(image.width, image.height);
        for (let i = cookedPoints.length - 1; i >= 0; i--) {
            let point = cookedPoints[i].sub(anchor);
            const origin = this._rotate(ctx, point, this._getRotationAt(i));
            if (origin) {
                point = origin;
            }

            Canvas.image(ctx, image, point.x, point.y);
            if (origin) {
                ctx.restore();
            }
        }
    }

    _createMarkerImage(ctx, resources) {
        const canvasClass = ctx.canvas.constructor,
            lineWidth = this.strokeAndFill['lineWidth'],
            shadow = this.geometry.options['shadowBlur'],
            w = round(this.style['markerWidth'] + lineWidth + 2 * shadow + this.padding[0] * 2),
            h = round(this.style['markerHeight'] + lineWidth + 2 * shadow + this.padding[1] * 2),
            canvas = Canvas.createCanvas(w, h, canvasClass),
            point = this._getAnchor(w, h);
        const context = canvas.getContext('2d');
        const gradient = isGradient(this.strokeAndFill['lineColor']) || isGradient(this.strokeAndFill['polygonFill']);
        if (!gradient) {
            Canvas.prepareCanvas(context, this.strokeAndFill, resources);
        }
        this._drawVectorMarker(context, point, resources);
        return canvas;
    }

    _stampSymbol() {
        if (!this._stamp) {
            this._stamp = [
                this.style['markerType'],
                isGradient(this.style['markerFill']) ? getGradientStamp(this.style['markerFill']) : this.style['markerFill'],
                this.style['markerFillOpacity'],
                this.style['markerFillPatternFile'],
                isGradient(this.style['markerLineColor']) ? getGradientStamp(this.style['markerLineColor']) : this.style['markerLineColor'],
                this.style['markerLineWidth'],
                this.style['markerLineOpacity'],
                this.style['markerLineDasharray'] ? this.style['markerLineDasharray'].join(',') : '',
                this.style['markerLinePatternFile'],
                this.style['markerWidth'],
                this.style['markerHeight']
            ].join('_');
        }
        return this._stamp;
    }

    _getAnchor(w, h) {
        const lineWidth = this.strokeAndFill['lineWidth'],
            shadow = this.geometry.options['shadowBlur'];
        const markerType = this.style['markerType'].toLowerCase();
        if (markerType === 'bar' || markerType === 'pie' || markerType === 'pin') {
            return new Point(w / 2, h - this.padding[1] - lineWidth / 2 - shadow);
        } else {
            return new Point(w / 2, h / 2);
        }
    }

    _getGraidentExtent(points) {
        const e = new PointExtent(),
            m = this.getMarkerExtent();
        if (Array.isArray(points)) {
            for (let i = points.length - 1; i >= 0; i--) {
                e._combine(points[i]);
            }
        } else {
            e._combine(points);
        }
        e['xmin'] += m['xmin'];
        e['ymin'] += m['ymin'];
        e['xmax'] += m['xmax'];
        e['ymax'] += m['ymax'];
        return e;
    }

    _drawVectorMarker(ctx, point, resources) {
        const style = this.style,
            strokeAndFill = this.strokeAndFill,
            markerType = style['markerType'].toLowerCase(),
            vectorArray = VectorMarkerSymbolizer._getVectorPoints(markerType, style['markerWidth'], style['markerHeight']),
            lineOpacity = strokeAndFill['lineOpacity'],
            fillOpacity = strokeAndFill['polygonOpacity'];
        const gradient = isGradient(strokeAndFill['lineColor']) || isGradient(strokeAndFill['polygonFill']);
        if (gradient) {
            let gradientExtent;
            if (isGradient(strokeAndFill['lineColor'])) {
                gradientExtent = this._getGraidentExtent(point);
                strokeAndFill['lineGradientExtent'] = gradientExtent.expand(strokeAndFill['lineWidth']);
            }
            if (isGradient(strokeAndFill['polygonFill'])) {
                if (!gradientExtent) {
                    gradientExtent = this._getGraidentExtent(point);
                }
                strokeAndFill['polygonGradientExtent'] = gradientExtent;
            }
            Canvas.prepareCanvas(ctx, strokeAndFill, resources);
        }


        const width = style['markerWidth'],
            height = style['markerHeight'];
        if (markerType === 'ellipse') {
            //ellipse default
            Canvas.ellipse(ctx, point, width / 2, height / 2, lineOpacity, fillOpacity);
        } else if (markerType === 'cross' || markerType === 'x') {
            for (let j = vectorArray.length - 1; j >= 0; j--) {
                vectorArray[j]._add(point);
            }
            //线类型
            Canvas.path(ctx, vectorArray.slice(0, 2), lineOpacity);
            Canvas.path(ctx, vectorArray.slice(2, 4), lineOpacity);
        } else if (markerType === 'diamond' || markerType === 'bar' || markerType === 'square' || markerType === 'triangle') {
            if (markerType === 'bar') {
                point = point.add(0, -style['markerLineWidth'] / 2);
            }
            for (let j = vectorArray.length - 1; j >= 0; j--) {
                vectorArray[j]._add(point);
            }
            //面类型
            Canvas.polygon(ctx, vectorArray, lineOpacity, fillOpacity);
        } else if (markerType === 'pin') {
            point = point.add(0, -style['markerLineWidth'] / 2);
            for (let j = vectorArray.length - 1; j >= 0; j--) {
                vectorArray[j]._add(point);
            }
            const lineCap = ctx.lineCap;
            ctx.lineCap = 'round'; //set line cap to round to close the pin bottom
            Canvas.bezierCurveAndFill(ctx, vectorArray, lineOpacity, fillOpacity);
            ctx.lineCap = lineCap;
        } else if (markerType === 'pie') {
            point = point.add(0, -style['markerLineWidth'] / 2);
            const angle = Math.atan(width / 2 / height) * 180 / Math.PI;
            const lineCap = ctx.lineCap;
            ctx.lineCap = 'round';
            Canvas.sector(ctx, point, height, [90 - angle, 90 + angle], lineOpacity, fillOpacity);
            ctx.lineCap = lineCap;
        } else {
            throw new Error('unsupported markerType: ' + markerType);
        }
    }

    getPlacement() {
        return this.symbol['markerPlacement'];
    }

    getRotation() {
        const r = this.style['markerRotation'];
        if (!isNumber(r)) {
            return null;
        }
        //to radian
        return r * Math.PI / 180;
    }

    getDxDy() {
        const s = this.style;
        const dx = s['markerDx'],
            dy = s['markerDy'];
        return new Point(dx, dy);
    }

    getMarkerExtent() {
        const dxdy = this.getDxDy(),
            style = this.style;
        const markerType = style['markerType'].toLowerCase();
        const width = style['markerWidth'],
            height = style['markerHeight'];
        let result;
        if (markerType === 'bar' || markerType === 'pie' || markerType === 'pin') {
            result = new PointExtent(dxdy.add(-width / 2, -height), dxdy.add(width / 2, 0));
        } else {
            result = new PointExtent(dxdy.add(-width / 2, -height / 2), dxdy.add(width / 2, height / 2));
        }
        if (this.style['markerLineWidth']) {
            result._expand(this.style['markerLineWidth'] / 2);
        }
        return result;
    }

    translate() {
        const s = this.symbol;
        const result = {
            'markerType': getValueOrDefault(s['markerType'], 'ellipse'), //<----- ellipse | cross | x | triangle | diamond | square | bar | pin等,默认ellipse
            'markerFill': getValueOrDefault(s['markerFill'], '#00f'), //blue as cartoCSS
            'markerFillOpacity': getValueOrDefault(s['markerFillOpacity'], 1),
            'markerFillPatternFile': getValueOrDefault(s['markerFillPatternFile'], null),
            'markerLineColor': getValueOrDefault(s['markerLineColor'], '#000'), //black
            'markerLineWidth': getValueOrDefault(s['markerLineWidth'], 1),
            'markerLineOpacity': getValueOrDefault(s['markerLineOpacity'], 1),
            'markerLineDasharray': getValueOrDefault(s['markerLineDasharray'], []),
            'markerLinePatternFile': getValueOrDefault(s['markerLinePatternFile'], null),

            'markerWidth': getValueOrDefault(s['markerWidth'], 10),
            'markerHeight': getValueOrDefault(s['markerHeight'], 10),

            'markerDx': getValueOrDefault(s['markerDx'], 0),
            'markerDy': getValueOrDefault(s['markerDy'], 0)
        };
        //markerOpacity覆盖fillOpacity和lineOpacity
        if (isNumber(s['markerOpacity'])) {
            result['markerFillOpacity'] *= s['markerOpacity'];
            result['markerLineOpacity'] *= s['markerOpacity'];
        }
        return result;
    }

    static translateLineAndFill(s) {
        const result = {
            'lineColor': s['markerLineColor'],
            'linePatternFile': s['markerLinePatternFile'],
            'lineWidth': s['markerLineWidth'],
            'lineOpacity': s['markerLineOpacity'],
            'lineDasharray': null,
            'lineCap': 'butt',
            'lineJoin': 'round',
            'polygonFill': s['markerFill'],
            'polygonPatternFile': s['markerFillPatternFile'],
            'polygonOpacity': s['markerFillOpacity']
        };
        if (result['lineWidth'] === 0) {
            result['lineOpacity'] = 0;
        }
        return result;
    }

    static _getVectorPoints(markerType, width, height) {
        //half height and half width
        const hh = height / 2,
            hw = width / 2;
        const left = 0,
            top = 0;
        let v0, v1, v2, v3;
        if (markerType === 'triangle') {
            v0 = new Point(left, top - hh);
            v1 = new Point(left - hw, top + hh);
            v2 = new Point(left + hw, top + hh);
            return [v0, v1, v2];
        } else if (markerType === 'cross') {
            v0 = new Point((left - hw), top);
            v1 = new Point((left + hw), top);
            v2 = new Point((left), (top - hh));
            v3 = new Point((left), (top + hh));
            return [v0, v1, v2, v3];
        } else if (markerType === 'diamond') {
            v0 = new Point((left - hw), top);
            v1 = new Point(left, (top - hh));
            v2 = new Point((left + hw), top);
            v3 = new Point((left), (top + hh));
            return [v0, v1, v2, v3];
        } else if (markerType === 'square') {
            v0 = new Point((left - hw), (top + hh));
            v1 = new Point((left + hw), (top + hh));
            v2 = new Point((left + hw), (top - hh));
            v3 = new Point((left - hw), (top - hh));
            return [v0, v1, v2, v3];
        } else if (markerType === 'x') {
            v0 = new Point(left - hw, top + hh);
            v1 = new Point(left + hw, top - hh);
            v2 = new Point(left + hw, top + hh);
            v3 = new Point(left - hw, top - hh);
            return [v0, v1, v2, v3];
        } else if (markerType === 'bar') {
            v0 = new Point((left - hw), (top - height));
            v1 = new Point((left + hw), (top - height));
            v2 = new Point((left + hw), top);
            v3 = new Point((left - hw), top);
            return [v0, v1, v2, v3];
        } else if (markerType === 'pin') {
            const extWidth = height * Math.atan(hw / hh);
            v0 = new Point(left, top);
            v1 = new Point(left - extWidth, top - height);
            v2 = new Point(left + extWidth, top - height);
            v3 = new Point(left, top);
            return [v0, v1, v2, v3];
        }
        return [];
    }
}


