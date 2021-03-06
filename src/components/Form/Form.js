import React, { Component, Fragment } from 'react';
import PropTypes from 'prop-types';
import { withRouter } from 'react-router-dom';
import { Mutation } from 'react-apollo';

import { Page, Form, Grid, Card, Button, Alert } from 'tabler-react';
import FormBody from './FormBody';

import {
	LIMIT,
	getFieldKind,
	isFieldRequired,
	getDataQueryName,
	snakeCase,
	buildDataQuery,
	buildCreateMutation,
	buildUpdateMutation,
	getListFieldKind,
	getPrimaryRelationField,
	getEnumFieldValues,
	hasValueChanged,
	processFormListValues,
	getListDataForSending,
} from '../../utils';

class DataForm extends Component {
	constructor(props) {
		super(props);
		const { type, editData, inputTypes, enumTypes } = props;

		const getEditValue = (
			fieldName,
			isRelationField,
			primaryRelationField,
		) => {
			if (!editData) return null;
			const fieldValue = editData[fieldName];

			if (Array.isArray(fieldValue)) {
				return fieldValue.map(
					val =>
						isRelationField && val
							? val[primaryRelationField.name]
							: val,
				);
			} else {
				return isRelationField && fieldValue
					? fieldValue[primaryRelationField.name]
					: fieldValue;
			}
		};

		const fields = type.fields.reduce(function(r, field) {
			if (!['id', 'createdAt', 'updatedAt'].includes(field.name)) {
				const isRelationField = field.args.length > 0;
				const primaryRelationField = isRelationField
					? getPrimaryRelationField(field, inputTypes)
					: null;

				r.push({
					name: field.name,
					type: getFieldKind(field),
					listType: getListFieldKind(field),
					isRequired: isFieldRequired(field),
					isRelationField,
					primaryRelationField: primaryRelationField && {
						name: primaryRelationField.name,
						type: getFieldKind(primaryRelationField),
					},
					enumValues: getEnumFieldValues(field, enumTypes),
					value:
						getEditValue(
							field.name,
							isRelationField,
							primaryRelationField,
						) || (getFieldKind(field) === 'LIST' ? [] : ''),
					error: null,
					isValueChanged: false,
				});
			}
			return r;
		}, []);

		this.state = {
			isEdit: !!editData,
			formData: fields,
		};
	}

	static propTypes = {
		type: PropTypes.object.isRequired,
		id: PropTypes.string,
		editData: PropTypes.object,
		history: PropTypes.shape({
			replace: PropTypes.func.isRequired,
		}).isRequired,
		inputTypes: PropTypes.object.isRequired,
		enumTypes: PropTypes.object.isRequired,
	};

	validateValues = field => {
		if (
			field.isRequired &&
			field.type !== 'Boolean' &&
			(!field.value || field.value === '')
		) {
			return 'Field is required';
		}
		if (field.type === 'Int' && !Number.isInteger(Number(field.value))) {
			return 'Not a number';
		}
		if (field.type === 'Float' && isNaN(Number(field.value))) {
			return 'Not a float';
		}

		return null;
	};

	onFieldChange = (name, value) => {
		const { formData, isEdit } = this.state;

		const updatedFormData = formData.map(field => {
			if (field.name === name) {
				field.value = value;
				field.isValueChanged =
					isEdit &&
					hasValueChanged(field, value, this.props.editData[name]);
				field.error = this.validateValues(field);
			}

			return field;
		});

		this.setState({ formData: updatedFormData });
	};

	handleSubmit = async (e, sendData) => {
		e.preventDefault();
		const { formData, isEdit } = this.state;
		const {
			history: { replace },
			editData,
			type,
			id,
		} = this.props;
		const validatedFormData = formData.map(field => {
			field.error = this.validateValues(field);
			return field;
		});
		const isFormValid =
			validatedFormData.filter(field => field.error).length === 0;

		this.setState({ formData: validatedFormData });

		if (isFormValid) {
			const variables = {};
			const filteredFormData = validatedFormData.filter(
				field =>
					// Include only changed values when editing
					(isEdit ? field.isValueChanged : true) &&
					(!field.isRelationField ||
						// Filter out relation fields without an id while editing
						// Filter optional relational fields without any value
						(field.primaryRelationField.name === 'id' &&
							field.value !== '')),
			);
			const formData = processFormListValues(filteredFormData, editData);

			variables.data = formData.reduce((r, field) => {
				if (field.isRelationField) {
					if (field.type === 'LIST') {
						r[field.name] = getListDataForSending(field.value);
					} else {
						r[field.name] = {
							connect: { id: field.value },
						};
					}
				} else {
					switch (field.type) {
						case 'Int':
						case 'Float':
							r[field.name] = Number(field.value);
							break;
						case 'LIST':
							r[field.name] = getListDataForSending(
								field.value,
								false,
								field.listType,
							);
							break;
						default:
							r[field.name] = field.value;
					}
				}
				return r;
			}, Object.create(null));

			if (isEdit) {
				variables.id = id;
			}

			const { error } = await sendData({ variables });

			if (!error) {
				replace(`/model/${snakeCase(type.name)}`);
			}
		}
	};

	render() {
		const { type, id, editData, inputTypes } = this.props;
		const { formData, isEdit } = this.state;
		const hasCreatedAt = type.fields.some(
			field => field.name === 'createdAt',
		);
		const hasUpdatedAt = type.fields.some(
			field => field.name === 'updatedAt',
		);

		return (
			<Page.Content title={`${isEdit ? 'Edit' : 'Create'} ${type.name}`}>
				<Mutation
					mutation={
						isEdit
							? buildUpdateMutation(type, inputTypes)
							: buildCreateMutation(type, inputTypes)
					}
					update={(cache, { data }) => {
						if (!isEdit) {
							const dataQuery = buildDataQuery(type);
							const queryVariables = { first: LIMIT, skip: 0 };
							let queryData = cache.readQuery({
								query: dataQuery,
								variables: queryVariables,
							});
							const dataFieldName = getDataQueryName(type);
							const createdFieldName = `create${type.name}`;
							queryData[dataFieldName] = queryData[
								dataFieldName
							].concat([data[createdFieldName]]);
							cache.writeQuery({
								query: dataQuery,
								data: queryData,
								variables: queryVariables,
							});
						}
					}}
				>
					{(sendData, { error }) => {
						return (
							<Card>
								{error && (
									<Alert type="danger">
										Form submission failed: {error.message}
									</Alert>
								)}
								<form
									onSubmit={e =>
										this.handleSubmit(e, sendData)
									}
								>
									<Card.Body>
										<Grid.Row>
											{isEdit && (
												<Fragment>
													<Grid.Col width={4}>
														<Form.Group label="ID">
															<Form.Input
																name="id"
																value={id}
																disabled
															/>
														</Form.Group>
													</Grid.Col>
													{hasCreatedAt && (
														<Grid.Col width={4}>
															<Form.Group label="Created At">
																<Form.Input
																	name="createdAt"
																	value={
																		editData.createdAt
																	}
																	disabled
																/>
															</Form.Group>
														</Grid.Col>
													)}
													{hasUpdatedAt && (
														<Grid.Col width={4}>
															<Form.Group label="Updated At">
																<Form.Input
																	name="updatedAt"
																	value={
																		editData.updatedAt
																	}
																	disabled
																/>
															</Form.Group>
														</Grid.Col>
													)}
												</Fragment>
											)}
											<FormBody
												formData={formData}
												isEdit={isEdit}
												onFieldChange={
													this.onFieldChange
												}
											/>
										</Grid.Row>
									</Card.Body>
									<Card.Footer className="text-right">
										<Button type="submit" color="primary">
											Submit
										</Button>
									</Card.Footer>
								</form>
							</Card>
						);
					}}
				</Mutation>
			</Page.Content>
		);
	}
}

export default withRouter(DataForm);
